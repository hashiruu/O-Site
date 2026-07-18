async function testLatest() {
    try {
        const res = await fetch("http://localhost:3024/api/media/latest");
        const json = await res.json();
        console.log(JSON.stringify(json, null, 2));
    } catch (e) {
        console.error("fetch failed", e);
    }
}
testLatest();
