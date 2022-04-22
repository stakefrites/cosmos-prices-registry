import axios from "axios";


class CoinGeckoApi { 
    async getPrice(id) {
        console.log(id)
        try {
            const response = await axios.get("https://api.coingecko.com/api/v3/simple/price", {
            params: {
                ids: id,
                vs_currencies: "usd,cad,eur"
            }
        });
        if (response.status == 200 && response.data[id]) {
            return response.data[id];
        } else { 
            return {[id]: "Error"}
        }
        } catch (error) {
         console.log(error.message)   
        }
    }
}

export default CoinGeckoApi;