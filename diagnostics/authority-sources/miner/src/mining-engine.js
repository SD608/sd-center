"use strict";

const crypto = require("node:crypto");

const ORES = Object.freeze([
  {
    key: "stone",
    name: "돌",
    weight: 476,
    probability: 47.6,
    price: 100,
  },
  {
    key: "copper",
    name: "구리",
    weight: 238,
    probability: 23.8,
    price: 500,
  },
  {
    key: "iron",
    name: "철",
    weight: 143,
    probability: 14.3,
    price: 1200,
  },
  {
    key: "emerald",
    name: "에메랄드",
    weight: 95,
    probability: 9.5,
    price: 3000,
  },
  {
    key: "diamond",
    name: "다이아몬드",
    weight: 48,
    probability: 4.8,
    price: 8000,
  },
]);

const ORE_MAP = new Map(
  ORES.map((ore) => [ore.key, ore]),
);

function drawOre() {
  const roll = crypto.randomInt(0, 1000);
  let cursor = 0;

  for (const ore of ORES) {
    cursor += ore.weight;

    if (roll < cursor) {
      return {
        key: ore.key,
        name: ore.name,
        probability: ore.probability,
        price: ore.price,
      };
    }
  }

  return {
    key: "stone",
    name: "돌",
    probability: 47.6,
    price: 100,
  };
}

function getOre(key) {
  return ORE_MAP.get(String(key)) || null;
}

module.exports = {
  ORES,
  drawOre,
  getOre,
};
