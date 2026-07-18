import { scanMediaDirectory } from "../lib/scanner";

async function main() {
    const scanPath = process.argv[2] || "./data";
    const scanType = process.argv[3] || "movie";
    const scanName = process.argv[4] || "Manual Scan";
    console.log(`Starting manual scan: ${scanPath} (${scanType})...`);
    try {
        const res = await scanMediaDirectory(scanPath, scanType, scanName, (msg) => console.log(msg));
        console.log("Scan complete:", res);
    } catch (e) {
        console.error("Scan failed:", e);
    }
}

main();
