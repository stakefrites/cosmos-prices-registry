import express from "express";
import CosmosDirectory from "./utils/directory.mjs";
import CoinGeckoApi from "./utils/CoinGeckoApi.mjs";
import Cache from "./utils/Redis.mjs";

const PORT = process.env.PORT || 5001;
const REDIS_PORT = process.env.REDIS_PORT || 6379;

const client = new Cache(REDIS_PORT);
await client.init()


const app = express();
const directory = CosmosDirectory();
const prices = new CoinGeckoApi;

const priceCache = async (req, res, next) => {
    console.log(req.params)
    const { chain } = req.params;
    const price = await client.getPrice(chain);
    if (price) {
        res.json(JSON.parse(price))
    } else { 
        next()
    }
}

const fetchPrice = async (req, res) => {
    console.log(req.params)
    const { chain } = req.params;

    const chains = await directory.getChains();
    const { coingecko_id } = chains[chain];

    const price = await prices.getPrice(coingecko_id);
    client.setPrice(chain,price)


    res.json(price);
}


app.get("/price/:chain",priceCache, fetchPrice);

app.get("/", async (req, res) => {
    const chains = await directory.getChains();
    const { coingecko_id } = chains.cosmoshub;
    const price = await prices.getPrice(coingecko_id);
    res.json(price)
})

app.listen(PORT, () => { 
    console.log(`Server listening on port ${PORT}`)
})

    

