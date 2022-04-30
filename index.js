import express from "express";
import router from "./router/router.mjs";

const PORT = process.env.PORT || 5001;

const app = express();

app.use("/api", router);

app.get("/", (req, res) => {
  res.json(`<h1>Welcome to pricemos</h1>
    `);
});

app.get("/health", (req, res) => {
  res.sendStatus(200).send("Ok");
});

app.listen(PORT, () => {
  console.log(`Server listening on port http://localhost:${PORT}`);
});
