import { createClient } from "redis";

class Cache {
    constructor(port) { 
        this.port = port;
    }
    async init() {
        this.client = createClient(this.port);
        await this.client.connect();
    }

    setPrice(chain, price) { 
        this.client.setEx(chain, 3600, JSON.stringify(price));
    }

    async getPrice(chain) { 
        return this.client.get(chain, (err, data) => {
            if (err) throw err;
            if (data !== null) {
                return data
            } else {
                return false
            }
        })
    }
}
 
export default Cache;
