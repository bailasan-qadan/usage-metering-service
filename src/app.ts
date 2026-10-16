import express from "express";
import { errorHandler } from "./middleware/errorHandler.js";
import { accountsRouter } from "./routes/accounts.js";

export const app = express();

app.use(express.json());

app.use(accountsRouter);

app.use(errorHandler);

app.use(errorHandler);
