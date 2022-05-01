import express from "express";
import CoinGeckoApi from "../utils/CoinGeckoApi.mjs";
import Cache from "../utils/Redis.mjs";
import AprClient from "../utils/AprClient.mjs";
import { Account, Chains } from "../utils/Account.mjs";
import _ from "lodash";
import { mapAsync } from "../utils/utils.js";

const router = express.Router();

// create and init redis client
const client = new Cache();
await client.init();

// create an instance of coingecko client
const prices = new CoinGeckoApi();

// APR

const aprCache = async (req, res, next) => {
  const { chain } = req.params;
  const apr = await client.getCache("apr-" + chain);
  if (apr) {
    res.json({ apr: JSON.parse(apr) });
  } else {
    next();
  }
};

const aprHandler = async (req, res) => {
  const { chain } = req.params;
  const chainsNamesCache = await client.getCache("chains");
  const chainData = JSON.parse(chainsNamesCache)[chain];
  if (chainData) {
    const aprClient = new AprClient(chainData);
    await aprClient.init();
    const apr = await aprClient.getChainApr();
    client.setCache("apr-" + chain, apr, 86400);
    res.json({ apr });
  } else {
    res.json({ error: "Chain is not supported" });
  }
};

// Prices

const priceCache = async (req, res, next) => {
  const { id } = req.params;
  let price = await client.getCache("price-" + id);
  if (price) {
    const parsedPrice = JSON.parse(price);
    price ? res.json(JSON.parse(price)) : next();
  } else {
    next();
  }
};

const fetchPrice = async (req, res) => {
  const { id } = req.params;
  if (id) {
    const price = await prices.getPrice(id);
    client.setCache("price-" + id, price, 1800);

    res.json(price);
  } else {
    res.json({ no: "price" });
  }
};

// LP

const lpCache = async (req, res, next) => {
  const { address } = req.params;
  const lpTokens = await client.getCache("lp-" + address);
  if (lpTokens) {
    res.json(JSON.parse(lpTokens));
  } else {
    next();
  }
};

const lpHandler = async (req, res) => {
  const { address } = req.params;
  const { chains } = req.query;
  const enabled = chains.split(",");
  const chaines = new Chains(enabled);
  await chaines.init();

  const theAccount = new Account(address, chaines.chains);
  const lp = await theAccount.getLp();
  client.setCache("lp-" + address, lp, 3600);
  res.json(lp);
};

// Balances

const balanceCache = async (req, res, next) => {
  const { address } = req.params;
  const chains = req.query.chains;
  const balance = await client.getCache(address + "?chains=" + chains);
  const parsedBal = JSON.parse(balance);
  if (parsedBal) {
    parsedBal.balances ? res.json(parsedBal) : next();
  } else {
    next();
  }
};

const balanceHandler = async (req, res) => {
  try {
    const { address } = req.params;
    const { chains } = req.query;
    const enabled = chains.split(",");
    const chaines = new Chains(enabled);
    await chaines.init();

    const theAccount = new Account(address, chaines.chains);
    await theAccount.fetch();
    const totalResponse = {
      address,
      balances: theAccount.total,
      chains,
    };
    client.setCache(address + "?chains=" + chains, totalResponse, 3600);
    res.json(totalResponse);
  } catch (error) {
    console.log(error);
    res.json({
      error: true,
    });
  }
};

// CHAINS

const chainsCache = async (req, res, next) => {
  const { chains } = req.query;
  const enabled = chains.split(",");
  const cached = await mapAsync(enabled, async (e) => {
    let cache = await client.getCache(e);
    cache = JSON.parse(cache);
    if (!cache) {
      return false;
    } else {
      return cache;
    }
  });
  cached.includes(false) ? next() : res.json(_.keyBy(cached, "name"));
};

const chainsHandler = async (req, res) => {
  const { chains } = req.query;
  const enabled = chains.split(",");
  const chaines = new Chains(enabled);
  await chaines.init();
  chaines.chains.map((c) => {
    client.setCache(c.name, c, 86400);
  });
  res.json(chaines.chains);
};

// TOKENS

const tokensCache = async (req, res, next) => {
  const cache = await client.getCache("tokens");
  if (cache) {
    res.json(JSON.parse(cache));
  } else {
    next();
  }
};

const tokenHandler = async (req, res) => {
  const chaines = new Chains();
  await chaines.fetchTokens();
  client.setCache("tokens", chaines.tokens, 86400);
  res.json(chaines.tokens);
};

////

// Attach routes /api

//apr by chainName
router.get("/apr/:chain", aprCache, aprHandler);

// price by id
router.get("/price/:id", priceCache, fetchPrice);

// tokens
router.get("/tokens", tokensCache, tokenHandler);

// chains
router.get("/chains", chainsCache, chainsHandler);

// balances
router.get("/balance/:address", balanceCache, balanceHandler);

// lp
router.get("/lp/:address", lpCache, lpHandler);

export default router;
