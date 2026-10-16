import express from "express";
import { errorHandler } from "./middleware/errorHandler.js";
import { accountsRouter } from "./routes/accounts.js";
import { consumeRouter } from "./routes/consume.js";
import { plansRouter } from "./routes/plans.js";
import { requestsRouter } from "./routes/requests.js";
import { usageRouter } from "./routes/usage.js";
import { usersRouter } from "./routes/users.js";

export const app = express();

app.use(express.json());

app.use(accountsRouter);
app.use("/users", usersRouter);
app.use("/plans", plansRouter);
app.use("/consume", consumeRouter);
app.use("/usage", usageRouter);
app.use("/requests", requestsRouter);

app.use(errorHandler);
