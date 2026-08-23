import { readFileSync, writeFileSync } from "node:fs";
import { parseCsv } from "@/lib/graph/csv";
import { buildGraph } from "@/lib/graph/build";

const raw = (name: string) => parseCsv(readFileSync(`data/raw/${name}`, "utf8"));

const graph = buildGraph({
  companies: raw("company.csv"),
  lines: raw("line.csv"),
  stations: raw("station.csv"),
  joins: raw("join.csv"),
});

writeFileSync("data/graph.json", JSON.stringify(graph));
process.stdout.write(
  `nodes: ${Object.keys(graph.nodes).length}, edges: ${graph.edges.length}\n`,
);
