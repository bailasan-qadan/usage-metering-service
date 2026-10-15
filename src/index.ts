import express from "express";

const app = express();

function getPort(): number {
  const parsed = Number(process.env.PORT);
  if (!process.env.PORT || Number.isNaN(parsed)) {
    return 3000;
  }
  return parsed;
}

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

const port: number = getPort();

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
