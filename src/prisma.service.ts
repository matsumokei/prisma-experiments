import { PrismaClient } from '@prisma/client';

  function formatSQL(sql: string): string {
    const keywords = [
      "SELECT",
      "FROM",
      "WHERE",
      "ORDER BY",
      "LIMIT",
      "OFFSET",
      "INSERT INTO",
      "VALUES",
      "UPDATE",
      "SET",
      "DELETE FROM",
    ];
    let formatted = sql;
    for (const keyword of keywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, "gi");
      formatted = formatted.replace(regex, `\n${keyword}`);
    }
    const lines = formatted.split("\n").map((line, index) => {
      if (index === 0) return line.trim();
      return `    ${line.trim()}`;
    });
    return lines.join("\n");
  }

export function createPrismaClient(): PrismaClient {
    const prisma = new PrismaClient({
        log: [
            { emit: "event", level: "query" },
            { emit: "event", level: "error" },
            { emit: "stdout", level: "info" },
            { emit: "event", level: "warn" },
        ],
    });

    // --- イベントリスナーの設定（ファクトリ内で一度だけ行う） ---
    prisma.$on("query", (e) => {
        console.log(`\x1b[36mQuery executed in ${e.duration}ms\x1b[0m`);
        console.log(`\x1b[32mSQL:\x1b[0m`);
        const formattedSQL = formatSQL(e.query);
        console.log(`  ${formattedSQL}`);
        console.log(`\x1b[33mParams:\x1b[0m ${e.params}`);
    });
    
    prisma.$on("error", (e) => {
        console.error(`\x1b[31mError:\x1b[0m ${e.message}`);
    });
    
    prisma.$on("info", (e) => {
        console.log(`\x1b[34mInfo:\x1b[0m ${e.message}`);
    });
    
    prisma.$on("warn", (e) => {
        console.warn(`\x1b[33mWarn:\x1b[0m ${e.message}`);
    });

    return prisma;
}