import express from "express";
import CosmosDirectory from "../utils/CosmosDirectory.mjs";
import CoinGeckoApi from "../utils/CoinGeckoApi.mjs";
import Cache from "../utils/Redis.mjs";
import AprClient from "../utils/AprClient.mjs";
import Account from "../utils/Account.mjs";

const router = express.Router();

const client = new Cache();
await client.init();
const directory = CosmosDirectory();
const prices = new CoinGeckoApi();

// Chains

const chainsCache = async (req, res, next) => {
  const chains = await client.getCache("chains");
  if (chains) {
    next();
  } else {
    const chains = await directory.getChains();
    client.setCache("chains", chains);
    next();
  }
};

const fetchChains = async (req, res, next) => {
  const chainsCache = await client.getCache("chains");
  if (chainsCache) {
    res.json(Object.keys(JSON.parse(chainsCache)));
  } else {
    const chains = await directory.getChains();
    const array = Object.keys(chains);
    client.setCache("chains", array);
    res.json(chains);
  }
};

// Prices

const priceCache = async (req, res, next) => {
  const { chain } = req.params;
  const price = await client.getCache(chain);
  if (price) {
    res.json(JSON.parse(price));
  } else {
    next();
  }
};

const fetchPrice = async (req, res) => {
  const { chain } = req.params;
  const chains = await client.getCache("chains");
  const chainData = JSON.parse(chains)[chain];
  if (chainData && chainData.coingecko_id) {
    const { coingecko_id } = JSON.parse(chains)[chain];

    const price = await prices.getPrice(coingecko_id);
    client.setCache(chain, price);

    res.json(price);
  } else {
    res.json({ no: "price" });
  }
};

const aprCache = async (req, res, next) => {
  const { chain } = req.params;
  const apr = await client.getCache("apr-" + chain);
  if (apr) {
    res.json({ apr: JSON.parse(apr) });
  } else {
    next();
  }
};

const balancesCache = async (req, res, next) => {
  const { address } = req.params;
  const balances = await client.getCache(address);
  if (balances) {
    res.json({ balances: JSON.parse(balances) });
  } else {
    next();
  }
};

const aprHandler = async (req, res) => {
  const { chain } = req.params;
  const chainsCache = await client.getCache("chains");
  const chainData = JSON.parse(chainsCache)[chain];
  if (chainData) {
    const aprClient = new AprClient(chainData);
    await aprClient.init();
    const apr = await aprClient.getChainApr();
    console.log(apr);
    client.setCache("apr-" + chain, apr);
    res.json({ apr });
  } else {
    res.json({ error: "Chain is not supported" });
  }
};

const balanceHandler = async (req, res) => {
  const { chain, address } = req.params;
  const chainsCache = await client.getCache("chains");
  const chainData = JSON.parse(chainsCache)[chain];
  if (chainData) {
    const aprClient = new AprClient(chainData);
    await aprClient.init();
    const isAddressValid = aprClient.validateAddress(address);
    if (isAddressValid) {
      const balance = await aprClient.getTotalBalances(address);
      client.setCache(address, balance);
      res.json({ balance });
    } else {
      res.json({ error: "Address Invalid" });
    }
  } else {
    res.json({ error: "Chain is not supported" });
  }
};

const chainsHandler = async (req, res) => {
  const chains = await directory.getChains();
  const chainNames = Object.values(chains);
  res.json(chainNames);
};

router.post("/balance/:address", async (req, res) => {
  const { address } = req.params;
  const body = req.body;
  res.json({ address });
});
/* 
router.get(
  "/balance/:chain/:address",
  balancesCache,
  chainsCache,
  balanceHandler
);
router.get("/apr/:chain", aprCache, chainsCache, aprHandler);
router.get("/price", chainsCache, fetchChains);
router.get("/price/:chain", priceCache, chainsCache, fetchPrice);
router.get("/chains", chainsHandler); */

export default router;
