// Rewrites the marked sections of README.md with the latest blog posts and the
// most recently pushed public repos. Run daily by .github/workflows/update-readme.yml.
import { readFile, writeFile } from "node:fs/promises";

const USER = "cjjutba";
const FEED = "https://cjjutba.dev/blog/rss.xml";
const POSTS = 4;
const REPOS = 5;
// Public repos to keep off the list. Forks, archived repos, repos without a
// description and this profile repo are already skipped.
const EXCLUDE = new Set(["prompt-enhancer-ai-builders"]);

const date = (d) =>
  new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

const decode = (s) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();

const tag = (xml, name) => decode(xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1] ?? "");

async function posts() {
  const res = await fetch(FEED);
  if (!res.ok) throw new Error(`${FEED} returned ${res.status}`);
  const xml = await res.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
    .map(([, item]) => ({ title: tag(item, "title"), link: tag(item, "link"), date: tag(item, "pubDate") }))
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, POSTS)
    .map((p) => `- [${p.title.replace(/[[\]]/g, "\\$&")}](${p.link}), ${date(p.date)}`);
}

// First sentence of the description, minus a leading "Name —" and anything
// after the next dash, which keeps each line short.
function summary(repo) {
  let s = repo.description.split(/(?<=\.)\s/)[0];
  s = s.replace(new RegExp(`^${repo.name}\\s*[—–-]\\s*`, "i"), "");
  s = s.split(/\s*[—–]\s*/)[0].trim();
  if (!/[.!?]$/.test(s)) s += ".";
  return s[0].toUpperCase() + s.slice(1);
}

// The users endpoint lists public repos only, whatever the token can see.
async function repos() {
  const headers = { Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/users/${USER}/repos?type=owner&sort=pushed&per_page=50`, { headers });
  if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
  return (await res.json())
    .filter((r) => !r.private && !r.fork && !r.archived && r.description && r.name !== USER && !EXCLUDE.has(r.name))
    .slice(0, REPOS)
    .map((r) => `- **[${r.name}](${r.html_url})**. ${summary(r)} Last push ${date(r.pushed_at)}.`);
}

// Throws instead of writing an empty list, so a failed fetch keeps the last good content.
function fill(readme, name, lines) {
  const re = new RegExp(`(<!-- ${name}:START -->)[\\s\\S]*?(<!-- ${name}:END -->)`);
  if (!re.test(readme)) throw new Error(`README.md is missing the ${name} markers`);
  if (!lines.length) throw new Error(`No entries for ${name}`);
  return readme.replace(re, (_, start, end) => `${start}\n${lines.join("\n")}\n${end}`);
}

const file = new URL("../README.md", import.meta.url);
let readme = await readFile(file, "utf8");
readme = fill(readme, "POSTS", await posts());
readme = fill(readme, "REPOS", await repos());
await writeFile(file, readme);
