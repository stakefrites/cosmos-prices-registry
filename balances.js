import { fromBech32, normalizeBech32, toBech32 } from "@cosmjs/encoding";
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

const mapAsync = async (array, fn) => {
  let promises = await Promise.allSettled(array.map(fn));
  return promises.map((p) => {
    if (p.status == "fulfilled") {
      return p.value;
    } else {
      return false;
    }
  });
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

const getIbcDenoms = async (coins, client) => {
  return await mapAsync(coins, async (c) => {
    if (c.denom.includes("ibc")) {
      const hash = c.denom.split("/")[1];
      const denomTrace = await client.ibc.transfer.denomTrace(hash);
      return {
        denom: denomTrace.denomTrace.baseDenom,
        amount: c.amount,
        ibcDenom: c.denom,
      };
    } else {
      return c;
    }
  });
};

const getAddresses = (address, chains) => {
  const decoded = fromBech32(address);
  return chains.map((c) => ({
    name: c.name,
    denom: c.denom,
    address: toBech32(c.prefix, decoded.data),
    rpc: c.best_apis.rpc[0].address,
  }));
};

const getBalances = async (addresses) => {
  return await mapAsync(addresses, async (a) => {
    const client = await makeClient(a.rpc);
    const allBalances = await client.bank.allBalances(a.address);
    const denoms = await getIbcDenoms(allBalances, client);
    return {
      address: a.address,
      liquid: denoms,
    };
  });
};

const getStaked = async (addresses) => {
  return await mapAsync(addresses, async (a) => {
    const client = await makeClient(a.rpc);
    const staked = await client.staking.delegatorDelegations(a.address);
    const chainStaked = staked.delegationResponses.map((d) => {
      return {
        validator: d.delegation.validatorAddress,
        amount: d.balance,
      };
    });
    const total =
      chainStaked.length !== 0
        ? chainStaked
            .map((s) => parseInt(s.amount.amount))
            .reduce((prev, curr) => {
              return prev + curr;
            })
        : 0;
    return {
      delegations: chainStaked,
      address: a.address,
      total: {
        amount: total,
        denom: a.denom,
      },
    };
  });
};

const getRewards = async (addresses) => {
  return await mapAsync(addresses, async (a) => {
    const client = await makeClient(a.rpc);
    const rewards = await client.distribution.delegationTotalRewards(a.address);
    const chainRewards = rewards.rewards.map((d) => {
      return {
        validator: d.validatorAddress,
        amount: d.reward,
      };
    });
    const total =
      chainRewards.length !== 0
        ? chainRewards
            .map((s) => parseInt(s.amount.amount))
            .reduce((prev, curr) => {
              return prev + curr;
            })
        : 0;
    return {
      rewards: chainRewards,
      address: a.address,
      total: {
        amount: total,
        denom: a.denom,
      },
    };
  });
};

const getAllBalances = async (address, chains) => {
  const addresses = getAddresses(address, chains);
  const liquid = await getBalances(addresses);
  const staked = await getStaked(addresses);
  const rewards = await getRewards(addresses);
  const s = _.keyBy(staked, "address");
  const r = _.keyBy(rewards, "address");
  const l = _.keyBy(liquid, "address");
  return addresses.map((a) => {
    return {
      name: a.name,
      address: a.address,
      allBalances: {
        rewards: r[a.address],
        liquid: l[a.address],
        staked: s[a.address],
      },
    };
  });
};
async function run() {
  let chains = await directory.getChains();
  const enabled = [
    "cosmoshub",
    "osmosis",
    "juno",
    "sifchain",
    "stargaze",
    "crescent",
  ];
  chains = Object.values(chains).filter((c) => enabled.includes(c.name));
  chains = await mapAsync(chains, async (c) => {
    const chainData = await directory.getChainData(c.name);
    return {
      ...c,
      prefix: chainData.bech32_prefix,
    };
  });
  const balances = await getAllBalances(
    "cosmos1xzzwtpwa9x4dmzgrp25g5s3e9n79a8wz7ymq7x",
    chains
  );
}

async function ru() {
  const client = await makeClient("https://rpc.cosmoshub.pupmos.network/");
  const u = await client.staking.delegatorUnbondingDelegations(
    "cosmos1attyjy6kdeewf7gpxswkh38af9qtncerlgy86e"
  );
  //console.log(u.unbondingResponses[0].entries[0]);
  const date = new Date(1653054927 * 1000);
  console.log(date);
  const form = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
  console.log(form);
}

ru();
