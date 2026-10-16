import express from "express";
import { errorHandler } from "./middleware/errorHandler.js";
import { accountsRouter } from "./routes/accounts.js";
import { usersRouter } from "./routes/users.js";

export const app = express();

app.use(express.json());

app.use(accountsRouter);
app.use("/users", usersRouter);

app.use(errorHandler);
