#!/usr/bin/env node
// Gera o bloco de estatisticas em ASCII do README a partir da API do GitHub.
// Uso: GITHUB_TOKEN=xxx node scripts/gh-stats.mjs [usuario]

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const USUARIO = process.argv[2] ?? process.env.GITHUB_REPOSITORY_OWNER ?? "botelllhx";
const TOKEN = process.env.GITHUB_TOKEN;
const README = fileURLToPath(new URL("../README.md", import.meta.url));
const INICIO = "<!-- STATS:START -->";
const FIM = "<!-- STATS:END -->";
const LARGURA_BARRA = 26;

if (!TOKEN) {
  console.error("GITHUB_TOKEN ausente. Rode dentro do GitHub Actions ou exporte um token.");
  process.exit(1);
}

async function gql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GraphQL ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

const { user } = await gql(
  `query($login: String!) {
    user(login: $login) {
      createdAt
      followers { totalCount }
      pullRequests { totalCount }
      issues { totalCount }
      repositories(first: 100, ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC) {
        totalCount
        nodes { stargazerCount primaryLanguage { name } }
      }
    }
  }`,
  { login: USUARIO }
);

// contributionsCollection cobre no maximo um ano por consulta, entao soma ano a ano.
const criadoEm = new Date(user.createdAt);
const agora = new Date();
let commits = 0;
let contribuiuEm = 0;

for (let ano = criadoEm.getUTCFullYear(); ano <= agora.getUTCFullYear(); ano++) {
  const de = new Date(Date.UTC(ano, 0, 1));
  const ate = new Date(Math.min(Date.UTC(ano, 11, 31, 23, 59, 59), agora.getTime()));
  if (de > agora) break;

  const dados = await gql(
    `query($login: String!, $de: DateTime!, $ate: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $de, to: $ate) {
          totalCommitContributions
          totalRepositoriesWithContributedCommits
        }
      }
    }`,
    { login: USUARIO, de: de.toISOString(), ate: ate.toISOString() }
  );

  const c = dados.user.contributionsCollection;
  commits += c.totalCommitContributions;
  contribuiuEm = Math.max(contribuiuEm, c.totalRepositoriesWithContributedCommits);
}

const repos = user.repositories.nodes;
const estrelas = repos.reduce((total, r) => total + r.stargazerCount, 0);

const porLinguagem = new Map();
for (const repo of repos) {
  const nome = repo.primaryLanguage?.name;
  if (nome) porLinguagem.set(nome, (porLinguagem.get(nome) ?? 0) + 1);
}
const linguagens = [...porLinguagem].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8);
const maiorLinguagem = linguagens[0]?.[1] ?? 1;
const larguraNome = Math.max(...linguagens.map(([nome]) => nome.length), 10);

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const desde = `${MESES[criadoEm.getUTCMonth()]}/${criadoEm.getUTCFullYear()}`;

function celula(rotulo, valor) {
  const base = `${rotulo} `;
  const pontos = ".".repeat(Math.max(1, 26 - base.length));
  return `${base}${pontos} ${String(valor).padStart(5)}`;
}

function barra(valor) {
  const cheio = Math.max(1, Math.round((valor / maiorLinguagem) * LARGURA_BARRA));
  return "\u2588".repeat(cheio) + "\u2591".repeat(LARGURA_BARRA - cheio);
}

const metricas = [
  ["COMMITS", commits],
  ["PULL REQUESTS", user.pullRequests.totalCount],
  ["ESTRELAS RECEBIDAS", estrelas],
  ["ISSUES", user.issues.totalCount],
  ["REPOSITORIOS PUBLICOS", user.repositories.totalCount],
  ["CONTRIBUIU EM", contribuiuEm],
  ["SEGUIDORES", user.followers.totalCount],
  ["NO GITHUB DESDE", desde],
];

const linhas = [];
linhas.push("```console");
linhas.push(`C:\\${USUARIO.toUpperCase()}> stats --all-time`);
linhas.push("");
for (let i = 0; i < metricas.length; i += 2) {
  const esquerda = celula(...metricas[i]);
  const direita = metricas[i + 1] ? celula(...metricas[i + 1]) : "";
  linhas.push(`  ${esquerda}   ${direita}`.trimEnd());
}
linhas.push("");
linhas.push(`C:\\${USUARIO.toUpperCase()}> stats --languages --by repo`);
linhas.push("");
for (const [nome, quantidade] of linguagens) {
  linhas.push(`  ${nome.padEnd(larguraNome)}  ${barra(quantidade)}  ${quantidade} repo${quantidade > 1 ? "s" : ""}`);
}
linhas.push("");
linhas.push(`C:\\${USUARIO.toUpperCase()}> _`);
linhas.push("```");

const bloco = linhas.join("\n");
const conteudo = readFileSync(README, "utf8");
const inicio = conteudo.indexOf(INICIO);
const fim = conteudo.indexOf(FIM);

if (inicio === -1 || fim === -1) {
  console.error(`Marcadores ${INICIO} / ${FIM} nao encontrados no README.`);
  process.exit(1);
}

const atualizado =
  conteudo.slice(0, inicio + INICIO.length) + "\n\n" + bloco + "\n\n" + conteudo.slice(fim);

if (atualizado === conteudo) {
  console.log("Estatisticas ja estavam atualizadas.");
} else {
  writeFileSync(README, atualizado);
  console.log("README atualizado.");
}

console.log(bloco);
