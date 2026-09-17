#!/usr/bin/env ts-node
import { Command } from "commander";
import fetch from "node-fetch";
import "dotenv/config";

const API = process.env.API_URL || "http://localhost:4000";
const program = new Command();

program.name("seo-geo").description("SEO / AEO / GEO CLI").version("0.1.0");

program.command("health").action(async () => {
  const r = await fetch(`${API}/health`);
  console.log(await r.json());
});

program.command("rank").action(async () => {
  const r = await fetch(`${API}/api/rank`);
  console.log(await r.json());
});

program.command("geo").action(async () => {
  const r = await fetch(`${API}/api/geo/visibility`);
  console.log(await r.json());
});

program.parse();
