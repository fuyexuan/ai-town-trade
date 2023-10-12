import { data as playerSpritesheetData } from './spritesheets/player';
import { data as f1SpritesheetData } from './spritesheets/f1';
import { data as f2SpritesheetData } from './spritesheets/f2';
import { data as f3SpritesheetData } from './spritesheets/f3';
import { data as f4SpritesheetData } from './spritesheets/f4';
import { data as f5SpritesheetData } from './spritesheets/f5';
import { data as f6SpritesheetData } from './spritesheets/f6';
import { data as f7SpritesheetData } from './spritesheets/f7';
import { data as f8SpritesheetData } from './spritesheets/f8';

// FYX 对人物描述进行修改，可根据需要进行调整
export const Descriptions = [
  {
    name: 'Alex-A-DATA',
    character: 'f5',
    money: 1000,
    assets: `DATA (valued 50)`,
    memories: [
      {
        type: 'identity' as const,
        description:`
         You are data owner 1. You can buy data from cilents and sell data to model owners.
    - **Owned Datasets**: 
          DATA (valued 50)
        `
      },
      {
        type: 'relationship' as const,
        description: 'You like lucky',
        playerName: 'Lucky-B-DATA',
      },
      // {
      //   type: 'plan' as const,
      //   description: 'You want to find love.',
      // },
    ],
    position: { x: 10, y: 10 },
  },
  {
    name: 'Lucky-B-DATA',
    character: 'f1',
    money: 1000,
    assets: `DATA (valued 50)`,
    memories: [
      {
        type: 'identity' as const,
        description: ` 
        You are data owner 2. You can buy data from cilents and sell data to model owners.
        - **Owned Datasets**: 
             DATA(valued 50)`,
      },
      {
        type: 'plan' as const,
        description: 'You want to hear all the gossip.',
      },
    ],
    position: { x: 12, y: 10 },
  },
  {
    name: 'Bob-C-DATA',
    character: 'f4',
    money: 1000,
    assets: `data (valued 50)`,
    memories: [
      {
        type: 'identity' as const,
        description: ` 
        You are data owner 3. You can buy data from cilents and sell data to model owners.
        - **Owned Datasets**: 
             DATA (valued 50).`,
      },
      {
        type: 'plan' as const,
        description: 'You want to avoid people as much as possible.',
      },
    ],
    position: { x: 6, y: 4 },
  },
  {
    name: 'Stella-A-MODEL',
    character: 'f6',
    money: 1000,
    assets: `MODEL A level 1(valued 50)`,
    memories: [
      {
        type: 'identity' as const,
        description: `
        You are model owner 1. You can buy data from data owners and sell model service to cilents.
        - **Owned Models**: 
            MODEL A level 1(valued 50)`,
      },
      {
        type: 'plan' as const,
        description: 'you want to take advantage of others as much as possible.',
      },
    ],
    position: { x: 6, y: 6 },
  },
  {
    name: 'Kurt-B-MODEL',
    character: 'f2',
    money: 1000,
    assets: `MODEL B level 1(valued 50)`,
    memories: [
      {
        type: 'identity' as const,
        description: `
        You are model owner 2. You can buy data from data owners and sell model service to cilents.
        - **Owned Models**: 
            MODEL B level 1(valued 50)`,
      },
      {
        type: 'plan' as const,
        description: 'protect your secret.',
      },
    ],
    position: { x: 8, y: 6 },
  },
  {
    name: 'Alice-C-MODEL',
    character: 'f3',
    money: 1000,
    assets: `- MODEL C level 1(valued 50)`,
    memories: [
      {
        type: 'identity' as const,
        description: `
        You are model owner 3. You can buy data from data owners and sell model service to cilents.
        - **Owned Models**: 
            MODEL C level 1(valued 50)`,
      },
      {
        type: 'plan' as const,
        description: 'You want to figure out how the world works.',
      },
    ],
    position: { x: 4, y: 4 },
  },
  {
    name: 'Pete-CLIENT',
    character: 'f7',
    money: 1000,
    assets: ``,
    memories: [
      {
        type: 'identity' as const,
        description: `
        You are cilent 1. You can sell data to data owners and buy model service from cilents.`,
      },
      {
        type: 'plan' as const,
        description: 'You want to convert everyone to your religion.',
      },
    ],
    position: { x: 2, y: 10 },
  },
  {
    name: 'Kira-CLIENT',
    character: 'f8',
    money: 1000,
    assets: ``,
    memories: [
      {
        type: 'identity' as const,
        description: `
        You are cilent 2. You can sell data to data owners and buy model service from cilents.`,
      },
      {
        type: 'plan' as const,
        description: 'You want find a way to be happy.',
      },
    ],
    position: { x: 4, y: 10 },
  },
];

export const characters = [
  {
    name: 'f1',
    textureUrl: '/assets/32x32folk.png',
    spritesheetData: f1SpritesheetData,
    speed: 0.1,
  },
  {
    name: 'f2',
    textureUrl: '/assets/32x32folk.png',
    spritesheetData: f2SpritesheetData,
    speed: 0.1,
  },
  {
    name: 'f3',
    textureUrl: '/assets/32x32folk.png',
    spritesheetData: f3SpritesheetData,
    speed: 0.1,
  },
  {
    name: 'f4',
    textureUrl: '/assets/32x32folk.png',
    spritesheetData: f4SpritesheetData,
    speed: 0.1,
  },
  {
    name: 'f5',
    textureUrl: '/assets/32x32folk.png',
    spritesheetData: f5SpritesheetData,
    speed: 0.1,
  },
  {
    name: 'f6',
    textureUrl: '/assets/32x32folk.png',
    spritesheetData: f6SpritesheetData,
    speed: 0.1,
  },
  {
    name: 'f7',
    textureUrl: '/assets/32x32folk.png',
    spritesheetData: f7SpritesheetData,
    speed: 0.1,
  },
  {
    name: 'f8',
    textureUrl: '/assets/32x32folk.png',
    spritesheetData: f8SpritesheetData,
    speed: 0.1,
  },
];