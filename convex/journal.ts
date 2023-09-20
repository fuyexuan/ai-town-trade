import { v } from 'convex/values';
import { Doc, Id } from './_generated/dataModel';
import { DatabaseReader, internalMutation, internalQuery } from './_generated/server';
import {
  Position,
  EntryOfType,
  EntryType,
  Player,
  MessageEntry,
  MemoryOfType,
  MemoryType,
} from './schema';
import { asyncMap, pruneNull } from './lib/utils';
import { getAllPlayers } from './players';
import { CLOSE_DISTANCE, DEFAULT_START_POSE, STUCK_CHILL_TIME, TIME_PER_STEP } from './config';
import { findCollision, findRoute } from './lib/routing';
import {
  calculateOrientation,
  getNearbyPlayers,
  getPoseFromMotion,
  getRemainingPathFromMotion,
  getRouteDistance,
  manhattanDistance,
  roundPose,
} from './lib/physics';
import { clientMessageMapper } from './chat';

/**
 * Reading state about the world
 */

export const getSnapshot = internalQuery({
  args: { playerIds: v.array(v.id('players')) },
  handler: async (ctx, args) => {
    const playerDocs = pruneNull(await asyncMap(args.playerIds, ctx.db.get));
    return {
      players: await asyncMap(playerDocs, (playerDoc) => getPlayer(ctx.db, playerDoc)),
    };
  },
});

export async function getPlayer(db: DatabaseReader, playerDoc: Doc<'players'>): Promise<Player> {
  const agentDoc = playerDoc.agentId ? await db.get(playerDoc.agentId) : null;
  const latestConversation = await getLatestPlayerConversation(db, playerDoc._id);
  const identityEntry = await latestMemoryOfType(db, playerDoc._id, 'identity');
  const identity = identityEntry?.description ?? 'I am a person.';
  const planEntry = await latestMemoryOfType(db, playerDoc._id, 'plan');

  return {
    id: playerDoc._id,
    name: playerDoc.name,
    agentId: playerDoc.agentId,
    characterId: playerDoc.characterId,
    identity,
    motion: await getLatestPlayerMotion(db, playerDoc._id),
    thinking: agentDoc?.thinking ?? false,
    lastPlan: planEntry ? { plan: planEntry.description, ts: planEntry._creationTime } : undefined,
    lastChat: latestConversation && {
      message: await clientMessageMapper(db)(latestConversation),
      conversationId: latestConversation.data.conversationId,
    },
  };
}

async function getLatestPlayerConversation(db: DatabaseReader, playerId: Id<'players'>) {
  const lastChat = await latestEntryOfType(db, playerId, 'talking');
  const lastStartChat = await latestEntryOfType(db, playerId, 'startConversation');
  const lastLeaveChat = await latestEntryOfType(db, playerId, 'leaveConversation');
  return pruneNull([lastChat, lastStartChat, lastLeaveChat])
    .sort((a, b) => a._creationTime - b._creationTime)
    .pop();
}

export async function getLatestPlayerMotion(db: DatabaseReader, playerId: Id<'players'>) {
  const lastStop = await latestEntryOfType(db, playerId, 'stopped');
  const lastWalk = await latestEntryOfType(db, playerId, 'walking');
  const latestMotion = pruneNull([lastStop, lastWalk])
    .sort((a, b) => a._creationTime - b._creationTime)
    .pop()?.data;
  return latestMotion ?? { type: 'stopped', reason: 'idle', pose: DEFAULT_START_POSE };
}

export async function latestEntryOfType<T extends EntryType>(
  db: DatabaseReader,
  playerId: Id<'players'>,
  type: T,
) {
  const entry = await db
    .query('journal')
    .withIndex('by_playerId_type', (q) => q.eq('playerId', playerId).eq('data.type', type))
    .order('desc')
    .first();
  if (!entry) return null;
  return entry as EntryOfType<T>;
}

export const getRelationships = internalQuery({
  args: { playerIds: v.array(v.id('players')) },
  handler: async (ctx, args) => {
    return asyncMap(args.playerIds, async (playerId) => {
      const otherPlayerIds = args.playerIds.filter((id) => id !== playerId);
      return {
        playerId,
        relations: await asyncMap(otherPlayerIds, async (otherPlayerId) => {
          const relationship = await latestRelationshipMemoryWith(ctx.db, playerId, otherPlayerId);
          return {
            id: otherPlayerId,
            relationship: relationship?.description,
          };
        }),
      };
    });
  },
});

async function latestRelationshipMemoryWith(
  db: DatabaseReader,
  playerId: Id<'players'>,
  otherPlayerId: Id<'players'>,
) {
  const entry = await db
    .query('memories')
    .withIndex('by_playerId_type', (q) =>
      q.eq('playerId', playerId).eq('data.type', 'relationship'),
    )
    .order('desc')
    .filter((q) => q.eq(q.field('data.playerId'), otherPlayerId))
    .first();
  if (!entry) return null;
  return entry as MemoryOfType<'relationship'>;
}

export async function latestMemoryOfType<T extends MemoryType>(
  db: DatabaseReader,
  playerId: Id<'players'>,
  type: T,
) {
  const entry = await db
    .query('memories')
    .withIndex('by_playerId_type', (q) => q.eq('playerId', playerId).eq('data.type', type))
    .order('desc')
    .first();
  if (!entry) return null;
  return entry as MemoryOfType<T>;
}

/**
 * Changing the state of the world
 */

export const makeConversation = internalMutation({
  args: { playerId: v.id('players'), audience: v.array(v.id('players')) },
  handler: async (ctx, { playerId, audience, ...args }) => {
    const playerDoc = (await ctx.db.get(playerId))!;
    const { worldId } = playerDoc;
    const conversationId = await ctx.db.insert('conversations', { worldId });
    await ctx.db.insert('journal', {
      playerId,
      data: {
        type: 'startConversation',
        audience,
        conversationId,
      },
    });
    return conversationId;
  },
});

export const talk = internalMutation({
  args: {
    playerId: v.id('players'),
    audience: v.array(v.id('players')),
    conversationId: v.id('conversations'),
    content: v.string(),
    relatedMemoryIds: v.array(v.id('memories')),
  },
  handler: async (ctx, { playerId, ...args }) => {
    if (args.audience.length === 0) {
      console.debug("Didn't talk: no audience");
      return null;
    }
    const entryId = await ctx.db.insert('journal', {
      playerId,
      data: { type: 'talking', ...args },
    });
    return await clientMessageMapper(ctx.db)((await ctx.db.get(entryId))! as MessageEntry);
  },
});

export const leaveConversation = internalMutation({
  args: {
    playerId: v.id('players'),
    audience: v.array(v.id('players')),
    conversationId: v.id('conversations'),
  },
  handler: async (ctx, { playerId, audience, conversationId, ...args }) => {
    await ctx.db.insert('journal', {
      playerId,
      data: { type: 'leaveConversation', audience, conversationId },
    });
  },
});

export const stop = internalMutation({
  args: {
    playerId: v.id('players'),
  },
  handler: async (ctx, { playerId }) => {
    const motion = await getLatestPlayerMotion(ctx.db, playerId);
    await ctx.db.insert('journal', {
      playerId,
      data: {
        type: 'stopped',
        reason: 'interrupted',
        // Future: maybe model stopping as a path of length 1 or 2 instead of
        // its own type. Then we can continue along the existing path instead of
        // snapping to the final location.
        // A path of length 2 could start in the past to make it smooth.
        pose: roundPose(getPoseFromMotion(motion, Date.now())),
      },
    });
  },
});

export const turnToFace = internalMutation({
  args: { playerId: v.id('players'), targetId: v.id('players') },
  handler: async (ctx, { playerId, targetId }) => {
    const us = await getLatestPlayerMotion(ctx.db, playerId);
    const them = await getLatestPlayerMotion(ctx.db, targetId);
    const targetPos = them.type === 'stopped' ? them.pose.position : them.route.at(-1)!;
    if (us.type === 'stopped') {
      us.pose.orientation = calculateOrientation(us.pose.position, targetPos);
    } else {
      us.endOrientation = calculateOrientation(us.route.at(-1)!, targetPos);
    }
    await ctx.db.insert('journal', {
      playerId,
      data: us,
    });
  },
});

export const walk = internalMutation({
  args: {
    agentId: v.id('agents'),
    ignore: v.array(v.id('players')),
    // Future: allow specifying a specific place to go, ideally a named Zone.
    target: v.optional(v.id('players')),
  },
  handler: async (ctx, { agentId, ignore, target }) => {
    const ts = Date.now();
    const agentDoc = (await ctx.db.get(agentId))!;
    const { playerId, worldId } = agentDoc;
    const world = (await ctx.db.get(worldId))!;
    const map = (await ctx.db.get(world.mapId))!;
    const otherPlayers = await asyncMap(
      (await getAllPlayers(ctx.db, worldId)).filter((p) => p._id !== playerId),
      async (p) => ({
        ...p,
        motion: await getLatestPlayerMotion(ctx.db, p._id),
      }),
    );
    const targetPosition = target
      ? getPoseFromMotion(await getLatestPlayerMotion(ctx.db, target), ts).position
      : getRandomPosition(map);
    const ourMotion = await getLatestPlayerMotion(ctx.db, playerId);
    const { route, distance } = findRoute(
      map,
      ourMotion,
      otherPlayers.map(({ motion }) => motion),
      targetPosition,
      ts,
    );
    if (distance === 0) {
      if (ourMotion.type === 'walking') {
        await ctx.db.insert('journal', {
          playerId,
          data: {
            type: 'stopped',
            pose: {
              position: route[0],
              orientation: calculateOrientation(route[0], targetPosition),
            },
            reason: 'interrupted',
          },
        });
      }
      return {
        targetEndTs: ts + STUCK_CHILL_TIME,
        // TODO: detect collisions with other players running into us.
      };
    }
    const exclude = new Set([...ignore, playerId]);
    const targetEndTs = ts + distance * TIME_PER_STEP;
    let endOrientation: number | undefined;
    if (manhattanDistance(targetPosition, route[route.length - 1]) > 0) {
      endOrientation = calculateOrientation(route[route.length - 1], targetPosition);
    }
    await ctx.db.insert('journal', {
      playerId,
      data: { type: 'walking', route, ignore, startTs: ts, targetEndTs, endOrientation },
    });
    const collisions = findCollision(
      route,
      otherPlayers.filter((p) => !exclude.has(p._id)),
      ts,
      CLOSE_DISTANCE,
    );
    return {
      targetEndTs,
      nextCollision: collisions && {
        ts: collisions.distance * TIME_PER_STEP + ts,
        agentIds: pruneNull(collisions.hits.map(({ agentId }) => agentId)),
      },
    };
  },
});

export const nextCollision = internalQuery({
  args: { agentId: v.id('agents'), ignore: v.array(v.id('players')) },
  handler: async (ctx, { agentId, ignore, ...args }) => {
    const ts = Date.now();
    const agentDoc = (await ctx.db.get(agentId))!;
    const { playerId, worldId } = agentDoc;
    const exclude = new Set([...ignore, playerId]);
    const otherPlayers = await asyncMap(
      (await getAllPlayers(ctx.db, worldId)).filter((p) => !exclude.has(p._id)),
      async (p) => ({ ...p, motion: await getLatestPlayerMotion(ctx.db, p._id) }),
    );
    const ourMotion = await getLatestPlayerMotion(ctx.db, playerId);
    const nearby = getNearbyPlayers(ourMotion, otherPlayers);
    nearby.forEach(({ _id: id }) => exclude.add(id));
    const othersNotNearby = otherPlayers.filter(({ _id }) => !exclude.has(_id));
    const route = getRemainingPathFromMotion(ourMotion, ts);
    const distance = getRouteDistance(route);
    const targetEndTs = ts + distance * TIME_PER_STEP;
    const collisions = findCollision(route, othersNotNearby, ts, CLOSE_DISTANCE);
    return {
      targetEndTs,
      nextCollision: collisions && {
        ts: collisions.distance * TIME_PER_STEP + ts,
        agentIds: pruneNull(collisions.hits.map(({ agentId }) => agentId)),
      },
    };
  },
});

export function getRandomPosition(map: Doc<'maps'>): Position {
  let pos;
  do
    pos = {
      x: Math.floor(Math.random() * map.bgTiles[0][0].length),
      y: Math.floor(Math.random() * map.bgTiles[0].length),
    };
  while (map.objectTiles[pos.y][pos.x] !== -1);
  return pos;
}

// FYX 新增加函数，功能：访问数据库添加交易记录
export const recordTrade = internalMutation({
  args: {
    sellerId: v.id('players'),
    sellerName: v.string(),
    buyerId: v.id('players'),
    buyerName: v.string(),
    price: v.number(),
    value: v.number(),
    item: v.string(),
    // item: v.array(v.string()),
  },
  handler: async (ctx, {sellerId, sellerName, buyerId, buyerName, price, value,item, ...args }) => {
    await ctx.db.insert('tradehistory', {
      sellerId,
      sellerName,
      buyerId,
      buyerName,
      price,
      value,
      item,
    });
  },
});

// FYX 新增加函数，功能：根据交易记录更新财产
export const updateProperties = internalMutation({
  args: {
    sellerId: v.id('players'),
    buyerId: v.id('players'),
    price: v.number(),
    value: v.number(),
    item: v.string(),
    buyer_gain: v.string(),
  },
  handler: async (ctx, { sellerId, buyerId, price, value, item, buyer_gain, ...args }) => {
    try {
      const seller_properties = await ctx.db
        .query('properties')
        .filter((q) => q.eq(q.field('playerId'), sellerId))
        .collect();
      if (seller_properties.length === 0) {
        throw new Error('Seller properties not found');
      }
      const seller_propertyId = seller_properties[0]._id; // Assuming there's only one matching property
      const seller_money = seller_properties[0].money; // Assuming there's only one matching property
      // Update the money and assets fields
      await ctx.db.patch(seller_propertyId, {
        money: seller_money + price,
      });

      
      const buyer_properties = await ctx.db
        .query('properties')
        .filter((q) => q.eq(q.field('playerId'), buyerId))
        .collect();
      if (buyer_properties.length === 0) {
        throw new Error('Buyer properties not found');
      }
      const buyer_propertyId = buyer_properties[0]._id; // Assuming there's only one matching property
      const buyer_name = buyer_properties[0].name; // Assuming there's only one matching property
      const buyer_money = buyer_properties[0].money; // Assuming there's only one matching property
      const buyer_assets = buyer_properties[0].assets; // Assuming there's only one matching property

      // // Update the money and assets fields

      if (buyer_name.endsWith("CLIENT")) {
        await ctx.db.patch(buyer_propertyId, {
          money: buyer_money - price + value * 1.5, //client购买服务后自己的钱增加
          assets: `${buyer_assets}, ${buyer_gain}`,
        });
      }
      else if (buyer_name.endsWith("MODEL")){
        await ctx.db.patch(buyer_propertyId, {
          money: buyer_money - price,
          assets: `${buyer_assets}, ${buyer_gain}`,
        });
      } else {//DATA
        await ctx.db.patch(buyer_propertyId, {
          money: buyer_money - price,
          assets: `${buyer_assets}, ${buyer_gain}`,
        });
      }

      return true; // Indicate success if needed
    } catch (e) {
      console.error(`Error updating player properties`);
      throw e;
    }
  },
});

// FYX 新增加函数，功能：获得 player的财产，提供给prompt进行售卖
export const getProperties = internalQuery({
  args: { playerId: v.id('players') },
  handler: async (ctx, { playerId, ...args }) => {
    const properties = await ctx.db
        .query('properties')
        .filter((q) => q.eq(q.field('playerId'), playerId))
        .collect();
      if (properties.length === 0) {
        throw new Error('Player properties not found');
      }
    // return properties;
    return {
      id: playerId,
      money: properties[0].money,
      assets: properties[0].assets,
    };
  },
});