import express from "express";
import { errorHandler } from "./middleware/errorHandler.js";

export const app = express();

app.use(express.json());

// Routes are registered here in later phases.

app.use(errorHandler);
