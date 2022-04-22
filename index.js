import express from "express";
import CosmosDirectory from "./utils/CosmosDirectory.mjs";
import CoinGeckoApi from "./utils/CoinGeckoApi.mjs";
import Cache from "./utils/Redis.mjs";
import AprClient from "./utils/AprClient.mjs"

const PORT = process.env.PORT || 5001;
const REDIS_PORT = process.env.REDIS_PORT || 6379;

const client = new Cache(REDIS_PORT);
await client.init()


const app = express();
const directory = CosmosDirectory();
const prices = new CoinGeckoApi;

// Chains

const chainsCache = async (req, res, next) => {
    const chains = await client.getCache("chains");
    if (chains) {
        next();
    } else { 
        const chains = await directory.getChains();
        client.setCache("chains", chains)
        next()
    }
}

const fetchChains = async (req, res, next) => {
    const chainsCache = await client.getCache("chains");
    if (chainsCache) {
        res.json(Object.keys(JSON.parse(chainsCache)));
    } else { 
        const chains = await directory.getChains();
        const array = Object.keys(chains);
        client.setCache("chains", array)
        res.json(chains);
    }
}


// Prices

const priceCache = async (req, res, next) => {
    const { chain } = req.params;
    const price = await client.getCache(chain);
    if (price) {
        res.json(JSON.parse(price))
    } else { 
        next()
    }
}

const fetchPrice = async (req, res) => {

    const { chain } = req.params;
    const chains = await client.getCache("chains");
    const chainData = JSON.parse(chains)[chain];
    if (chainData && chainData.coingecko_id) {
        const { coingecko_id } = JSON.parse(chains)[chain];

        const price = await prices.getPrice(coingecko_id);
        client.setCache(chain, price)


        res.json(price);
    } else { 
        res.json({"no": "price"})
    }
    
}

app.get("/price", chainsCache, fetchChains);
app.get("/price/:chain", priceCache, chainsCache, fetchPrice);


const aprCache = async (req, res, next) => {
    const { chain } = req.params;
    const apr = await client.getCache("apr-"+chain);
    if (apr) {
        res.json({ apr: JSON.parse(apr) })
    } else { 
        next()
    }
}

app.get("/apr/:chain",aprCache,chainsCache, async (req,res) => { 
    const { chain } = req.params;
    const chainsCache = await client.getCache("chains");
    const chainData = JSON.parse(chainsCache)[chain];
    if (chainData) {
        const aprClient = new AprClient(chainData);
        await aprClient.init();
        const apr = await aprClient.getChainApr();
        console.log(apr)
        client.setCache("apr-" + chain, apr);
        res.json({ apr })
    } else { 
        res.json({no: "data"})
    }
});

app.get("/chains", async (req, res) => {
    const chains = await directory.getChains();
    const chainNames = Object.values(chains)
    res.json(chainNames)
    
});

app.get("/", (req, res) => {
    
    res.json(`<h1>Welcome to pricemos</h1>
    `)
})

app.get("/health", (req, res) => {
    res.sendStatus(200).send("Ok")
})


app.listen(PORT, () => { 
    console.log(`Server listening on port ${PORT}`)
})

    

