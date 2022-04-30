import { fromBech32, normalizeBech32 } from "@cosmjs/encoding";
import {
  ethToEvmos,
  cosmosToEth,
  ethToEthermint,
} from "@tharsis/address-converter";
import CosmosDirectory from "./utils/CosmosDirectory.mjs";
import _ from "lodash";
import axios from "axios";
import {
  setupStakingExtension,
  QueryClient as CosmjsQueryClient,
  setupBankExtension,
  setupDistributionExtension,
  setupMintExtension,
  setupGovExtension,
  setupIbcExtension,
} from "@cosmjs/stargate";
import { Tendermint34Client } from "@cosmjs/tendermint-rpc";
import fs from "fs";

const mapAsync = (array, fn) => {
  return Promise.all(array.map(fn));
};

const directory = CosmosDirectory();

const makeClient = async (rpcUrl) => {
  const tmClient = await Tendermint34Client.connect(rpcUrl);
  return CosmjsQueryClient.withExtensions(
    tmClient,
    setupStakingExtension,
    setupIbcExtension,
    setupBankExtension,
    setupDistributionExtension,
    setupMintExtension,
    setupGovExtension
  );
};

const getAllIbcDenoms = async () => {
  const chains = await directory.getChains();
  const chainsArray = Object.values(chains).filter((e) => e.best_apis.rpc[0]);
  const allDenoms = await mapAsync(chainsArray, async (chain) => {
    const { name, best_apis } = chain;
    const rpc = best_apis.rpc[0].address;
    const denoms = await getIbcDenoms(rpc);
    return {
      name,
      denoms,
    };
  });
  console.log(allDenoms);
  fs.writeFileSync("denoms.json", JSON.stringify(allDenoms));
};

const getIbcDenoms = async (rpc) => {
  const client = await makeClient(rpc);
  const totalSupply = await client.bank.totalSupply();
  const supplied = await mapAsync(
    totalSupply.filter((e) => e.denom.includes("ibc")),
    async ({ denom }) => {
      const hash = denom.split("/")[1];
      const denomTrace = await client.ibc.transfer.denomTrace(hash);
      return {
        baseDenom: denomTrace.denomTrace.baseDenom,
        ibcDenom: denom,
      };
    }
  );
  return supplied;
};

async function getOsmosisBalances(address) {
  const chains = await directory.getChains();
  const rest = "https://api-osmosis.imperator.co/";
  const locked = await axios.get(
    "https://lcd-osmosis.keplr.app/osmosis/lockup/v1beta1/account_locked_coins/" +
      address
  );
  const lockedCoins = locked.data.coins;
  const rpc = chains.osmosis.best_apis.rpc[0].address;
  const client = await makeClient(rpc);
  const balances = await client.bank.allBalances(address);

  const path = rest + "tokens/v2/all";
  const tokensData = await axios.get(path);
  const allTokens = tokensData.data.map(
    ({ price, denom, symbol, exponent }) => ({
      price,
      denom,
      symbol,
      exponent,
    })
  );
  const pairsData = await axios.get(rest + "pairs/v1/summary");
  const allPairs = pairsData.data;
  const objPairs = _.keyBy(allPairs.data, "pool_id");
  let tokens = await mapAsync(balances.concat(lockedCoins), async (b) => {
    let data = allTokens.find((t) => t.denom == b.denom);

    if (!data) {
      const poolId = b.denom.split("/")[2];
      const supply = await client.bank.supplyOf(b.denom);
      let liquidity = objPairs[poolId].liquidity;
      let value = (b.amount / supply.amount) * liquidity;
      let realAmount = b.amount / Math.pow(10, 18);
      let price = value / realAmount;
      data = {
        ...b,
        symbol:
          objPairs[poolId].base_symbol + "/" + objPairs[poolId].quote_symbol,
        price,
        amount: realAmount,
      };
    } else {
      data = {
        ...b,
        ...data,
        amount: parseInt(b.amount) / Math.pow(10, data.exponent),
      };
    }

    return data;
  });
  console.log(tokens);
  return tokens;
}
//getOsmosisBalances("osmo1xzzwtpwa9x4dmzgrp25g5s3e9n79a8wzklgsg5");

function toEvmos(add) {
  const l = cosmosToEth(add);
  return ethToEvmos(l);
  return l;
}

const fetchPrices = async ({ commit, state }) => {
  const chains = state.networks.selected;
  const asyncs = await mapAsync(chains, (chain) => {
    const { coinGeckoId } = chain;
    if (coinGeckoId !== undefined) {
      const datarr = axios.get(
        "https://api.coingecko.com/api/v3/simple/price",
        {
          params: {
            ids: coinGeckoId,
            vs_currencies: "usd,cad,eur",
          },
        }
      );
      return datarr;
    }
  });
  const mappedRequest = asyncs.map((price, i) => {
    console.log(price);
    const configChain = chains[i];
    return {
      price:
        price.status === "fulfilled"
          ? price.value.data[configChain.coinGeckoId].usd
          : 0,
      prices:
        price.status === "fulfilled"
          ? price.value.data[configChain.coinGeckoId]
          : { usd: 0, cad: 0, eur: 0 },
      name: price.status === "fulfilled" ? configChain.name : configChain.name,
    };
  });

  const pricesMap = _.keyBy(mappedRequest, "name");
  commit("setPrices", pricesMap);
  commit("setIsPricesLoaded", true);
  return mappedRequest;
};

const chains = await directory.getChains();
const cosmos = chains.cosmoshub;
const td = await directory.getTokenData(cosmos.name);
const cd = await directory.getChainData(cosmos.name);
console.log(cd, td, cosmos);
//getAllIbcDenoms();
