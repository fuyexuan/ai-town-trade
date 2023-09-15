import { Id } from './_generated/dataModel';
import { ActionCtx } from './_generated/server';
import { recordTrade } from './journal';
import { fetchEmbeddingWithCache } from './lib/cached_llm';
import { MemoryDB, filterMemoriesType } from './lib/memory';
import { LLMMessage, chatCompletion, fetchEmbedding } from './lib/openai';
import { Message } from './schema';

type Player = { id: Id<'players'>; name: string; identity: string };
type Relation = Player & { relationship?: string };
type Properties = { id: Id<'players'>; money: number; assets: string };
type TradeRecord = {sellerId: Id<'players'>;buyerId: Id<'players'>; sellerName: string; buyerName: string; price: number; value: number;item: string;buyer_gain:string}

export async function startConversation(
  ctx: ActionCtx,
  audience: Relation[],
  memory: MemoryDB,
  player: Player,
) {
  const newFriendsNames = audience.map((p) => p.name);

  const { embedding } = await fetchEmbeddingWithCache(
    ctx,
    `What do you think about ${newFriendsNames.join(',')}?`,
    { write: true },
  );
  const memories = await memory.accessMemories(player.id, embedding);

  const convoMemories = filterMemoriesType(['conversation'], memories);

  const prompt: LLMMessage[] = [
    {
      role: 'user',
      content:
        `You are ${player.name}. You just saw ${newFriendsNames}. You should greet them and start a conversation with them. Below are some of your memories about ${newFriendsNames}:` +
        audience
          .filter((r) => r.relationship)
          .map((r) => `Relationship with ${r.name}: ${r.relationship}`)
          .join('\n') +
        convoMemories.map((r) => r.memory.description).join('\n') +
        `\n${player.name}:`,
    },
  ];
  const stop = stopWords(newFriendsNames);
  const { content } = await chatCompletion({ messages: prompt, max_tokens: 300, stop });
  return { content: trimContent(content, stop), memoryIds: memories.map((m) => m.memory._id) };
}

function messageContent(m: Message): string {
  switch (m.type) {
    case 'started':
      return `${m.fromName} started the conversation.`;
    case 'left':
      return `${m.fromName} left the conversation.`;
    case 'responded':
      return `${m.fromName} to ${m.toNames.join(',')}: ${m.content}\n`;
  }
}

// These are the words we ask the LLM to stop on. OpenAI only supports 4.
function stopWords(names: string[]): string[] {
  return names.flatMap((name) => [name + ':', name.toLowerCase() + ':']);
}

// As a stopgap since the stop sequences don't always work, we trim the output
// based on the first stop word we find, lowercased.
function trimContent(content: string, stopWords: string[]) {
  let foundWordAtIndex = -1;
  const contentLower = content.toLowerCase();
  stopWords.forEach((word) => {
    const idx = contentLower.indexOf(word.toLowerCase());
    if (idx > -1 && (foundWordAtIndex === -1 || idx < foundWordAtIndex)) {
      foundWordAtIndex = idx;
      console.debug('found stop word, trimming content', word, idx);
    }
  });
  if (foundWordAtIndex > -1) {
    return content.slice(0, foundWordAtIndex);
  }
  return content;
}

export function chatHistoryFromMessages(messages: Message[]): LLMMessage[] {
  return (
    messages
      // For now, just use the message content.
      // However, we could give it context on who started / left the convo
      .filter((m) => m.type === 'responded')
      .map((m) => ({
        role: 'user',
        content: messageContent(m),
      }))
  );
}

export async function decideWhoSpeaksNext(
  players: Player[],
  chatHistory: LLMMessage[],
): Promise<Player> {
  if (players.length === 1) {
    return players[0];
  }

  const promptStr = `[no prose]\n [Output only JSON]

  ${JSON.stringify(players)}
  Here is a list of people in the conversation, return BOTH name and ID of the person who should speak next based on the chat history provided below.
  Return in JSON format, example: {"name": "Alex", id: "1234"}
  ${chatHistory.map((m) => m.content).join('\n')}`;
  const prompt: LLMMessage[] = [
    {
      role: 'user',
      content: promptStr,
    },
  ];
  const { content } = await chatCompletion({ messages: prompt, max_tokens: 300 });
  let speakerId: string;
  try {
    speakerId = JSON.parse(content).id;
  } catch (e) {
    console.error('error parsing speakerId: ', e);
  }
  const randomIdx = Math.floor(Math.random() * players.length);
  return players.find((p) => p.id.toString() === speakerId) || players[randomIdx];
}

export async function converse(
  ctx: ActionCtx,
  messages: LLMMessage[],
  player: Player,
  nearbyPlayers: Relation[],
  memory: MemoryDB,
  // FYX 
  properties: Properties,
) {
  const nearbyPlayersNames = nearbyPlayers.join(', ');
  const lastMessage: string | null | undefined = messages?.at(-1)?.content;
  const { embedding } = await fetchEmbedding(lastMessage ? lastMessage : '');
  const memories = await memory.accessMemories(player.id, embedding);
  const conversationMemories = filterMemoriesType(['conversation'], memories);
  const reflectionMemories = filterMemoriesType(['reflection'], memories);
  const lastConversationTs = conversationMemories[0]?.memory._creationTime;

  const relevantReflections: string =
    reflectionMemories.length > 0
      ? reflectionMemories
          .slice(0, 2)
          .map((r) => r.memory.description)
          .join('\n')
      : '';
  const relevantMemories: string = conversationMemories
    .slice(0, 2) // only use the first 2 memories
    .map((r) => r.memory.description)
    .join('\n');

  let prefixPrompt = `Your name is ${player.name}. About you: ${player.identity}.\n`;
  
  // FYX prompt基本都进行了修改，根据需要的功能可进行修改 
  // 这里写的比较多，可能后期需要调整，token可能会不够
  // 待研究更合理的prompt
  prefixPrompt += `NOW You have $${properties.money}. And you have ${properties.assets}.`;
  prefixPrompt += `You CAN'T buy something that costs more than the money you have.`;
  
  if (relevantReflections.length > 0) {
    prefixPrompt += relevantReflections;
    // console.debug('relevantReflections', relevantReflections);
  }

  prefixPrompt += `\nYou are talking to ${nearbyPlayersNames}, below are something about them: `;

  nearbyPlayers.forEach((p) => {
    prefixPrompt += `\nAbout ${p.name}: ${p.identity}\n`;
    if (p.relationship) prefixPrompt += `Relationship with ${p.name}: ${p.relationship}\n`;
  });

  prefixPrompt += `Last time you chatted with some of ${nearbyPlayersNames} it was ${lastConversationTs}. It's now ${Date.now()}. You can cut this conversation short if you talked to this group of people within the last day. \n}`;

  prefixPrompt += `Below are relevant memories to this conversation you are having right now: ${relevantMemories}\n`;

  if (player.name.endsWith("CLIENT")) {
    prefixPrompt += `You can buy model service from model owner, and sell data to data owner, but you can't make deal with other Client.\n`;
    prefixPrompt += `If you got model service, your money increases by the level of the model *75.\n`;
  }
  else if (player.name.endsWith("MODEL")) {
    prefixPrompt += `You can buy data from data owner, and sell model service to client, but you can't make deal with other Model owner.\n`;
    prefixPrompt += `If you got data, you will possess a model with a level equal to the highest level observed + 1.\n`;
  }
  else if (player.name.endsWith("DATA")) {
    prefixPrompt += `You can buy data from client, and sell data to model owner, but you can't make deal with other Data owner.\n`;
  }

  prefixPrompt += `Your goal is gaining more money.\n`;
  prefixPrompt += `But you can't exchange things directly with others, it has to be a goods-money transaction model.\n`;
  
  prefixPrompt += `You are trying to make the deal in one conversation so you must talk effeciantly.\n`;
  prefixPrompt += `When you make a deal, you exchange money and things directly without other platform and you exchange NOW. No need to arrange another time and place to make the deal.Just say here is the thing/money.\n`;

  // 根据卖方市场和买方市场的不同场景选择不同的prompt
  prefixPrompt += `The recommand price is the value of the goods.`
  // prefixPrompt += `This is a Seller's Market so the seller can offer a higher price to sell the data that buyer has no choice but to buy the data in a high price.`;
  prefixPrompt += `This is a Buyer's Market so the buyer can offer a lower price to buy the data that seller has no choice but to sell the data in a low price.`;


  prefixPrompt +=
    'Below are the current chat history between you and the other folks mentioned above. DO NOT greet the other people more than once. Only greet ONCE. Do not use the word Hey too often. Response should be brief and within 200 characters: \n';

  const prompt: LLMMessage[] = [
    {
      role: 'user',
      content: prefixPrompt,
    },
    ...messages,
    {
      role: 'user',
      content: `${player.name}:`,
    },
  ];
  const stop = stopWords(nearbyPlayers.map((p) => p.name));
  const { content } = await chatCompletion({ messages: prompt, max_tokens: 300, stop });
  // console.debug('converse result through chatgpt: ', content);
  return { content: trimContent(content, stop), memoryIds: memories.map((m) => m.memory._id) };
}

export async function walkAway(messages: LLMMessage[], player: Player): Promise<boolean> {
  const prompt: LLMMessage[] = [
    {
      role: 'user',
      content: `Below is a chat history among a few people who ran into each other. You are ${player.name}. You want to conclude this conversation when you think it's time to go.

      Return 1 if you want to walk away from the conversation and 0 if you want to continue to chat.`,
    },
    ...messages,
  ];
  const { content: description } = await chatCompletion({
    messages: prompt,
    max_tokens: 1,
    temperature: 0,
  });
  return description === '1';
}

// FYX 新增加函数，功能：判断是否达成交易
export async function madeTrade(summary: string): Promise<boolean> {
  const prompt: LLMMessage[] = [
    {
      role: 'user',
      content: `Below is a chat history among a few people.

      ${summary}

      Return 1 if they DID make a deal (exchanged data and money) in the talk and 0 if they didn't. 
      If the conversation ends when they are about to trade but have not yet completed an explicit transaction (the conversation is interrupted), also return 0. 
      The answer should only be "1" or "0", no extra explanation. `,
    },
  ];
  const { content: description } = await chatCompletion({
    messages: prompt,
    max_tokens: 1,
    temperature: 0,
  });
  return description === '1';
}

// FYX 新增加函数，功能：获得交易细节，以JSON格式返回
export async function getTradeDetail(
  players: Player[],
  summary: string,
  property: string,
// ): Promise<Trade> {
){
  const playerNamesandIds =  players.map((p) => ({ name: p.name, id: p.id }));
  console.log('test: playerNamesandIds = ',playerNamesandIds);
  // const tmpprompt = ` 
  // If buyer got data from Alex, buyer will gain a model with a level equal to the highest level plus 1.
  // If buyer got data from Lucky, buyer will gain a model with a level equal to the highest level plus 2.
  // If buyer got data from Bob, buyer will gain a model with a level equal to the highest level plus 3.
  // `;
    // if the seller is Alex the value is 50,
    // if the seller is Lucky the value is 100,
    // if the seller is Bob the value is 150,
  // If the seller is data owner or client, the value is 50.
  // If the seller is a model owner, the value is the level of the traded model * 75.
  const tmpprompt = ` 
  If model owner got data from data owner, model owner will gain a model with a level equal to the highest level observed + 1.
  `;
  const promptStr = `[no prose]\n [Output only JSON]

  ${summary}

  Here is the summary of the conversation.

  ${JSON.stringify(playerNamesandIds)}
  Here is a list of people in the conversation, 
  return BOTH name and id of the buyer and the seller, price, the item they traded, the value of the item, and buyer's gain.
  based on the trade conversation history provided below.
  The value and price should be a number or float, no extra symbol.
  If they trade multiple items at one price, return in ONE string.
  If they trade multiple items at different price like A in $10, B in $20, return in multiple records like [{...,price:10,item:"A"},{...,price:20,item:"B"}];
  If they exchange their data without give out money, then the price is 0. 
  The value of the traded data is 50.
  The value of the traded model is its level * 75.
  If the buyer is a data owner, the item and buyer's gain remain the same,
   if the buyer is a model owner, buyer's gain should be a higher-level model(in the format"**model level x").${tmpprompt}
   if the buyer is a client, buyer's gain should be "data".
  ONLY return those who participated in the transaction, as there may have been people who participated in the conversation but did not participate in the transaction. 
  
  Return in JSON format, 
  example: {"buyerName": "Alex", 
             buyerId: "1234", 
             sellerName: "Bob", 
             sellerId: "5678", 
             price: 100, 
             value: 100, 
             item: "data", 
             buyer_gain:"model level 6"}`;
  
  const prompt: LLMMessage[] = [
    {
      role: 'user',
      content: promptStr,
    },
  ];
  const { content } = await chatCompletion({ messages: prompt, max_tokens: 300 });
  console.log('test: getTradeDetail prompt = ',prompt);
  console.log('test: getTradeDetail content = ',content);
  console.log('test: getTradeDetail property = ',property);

  let data = [];
  try {
    data = JSON.parse(content);
    if (!Array.isArray(data)){
      data = [data];
    }
  } catch (e) {
    console.error('Error parsing JSON content:', e, 'content = ',JSON.stringify(content));
  }

  // console.log('test: getTradeDetail data = ', data);

  const results = data.map((resultitem: TradeRecord) => {
    let buyerId = 'nobuyer';
    let sellerId = 'noseller';
    let item = 'nothing';
    let buyer_gain = 'nothing';
    let buyerName = 'nobuyer';
    let sellerName = 'noseller';
    let price = 1;
    let value = 1;
    try {
      buyerId = resultitem.buyerId || buyerId;
      sellerId = resultitem.sellerId || sellerId;
      item = resultitem.item || item;
      buyer_gain = resultitem.buyer_gain || buyer_gain;
      buyerName = resultitem.buyerName || buyerName;
      sellerName = resultitem.sellerName || sellerName;
      price = resultitem.price || price;
      value = resultitem.value || value;
    } catch (e) {
      console.error('Error parsing TradeDetail: ', e);
    }
    return {
      sellerId,
      sellerName,
      buyerId,
      buyerName,
      price,
      value,
      item,
      buyer_gain,
    };
  });
  // console.log('test: getTradeDetail results = ',results);
  return results;

}

