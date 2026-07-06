import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const filePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/components/CrmModule.tsx");
let s = fs.readFileSync(filePath, "utf8");
const bad = "</motion.div>";
const good = "</div>";
const count = s.split(bad).length - 1;
console.log("replacing", count, "occurrences");
s = s.split(bad).join(good);
fs.writeFileSync(filePath, s);
