async function fetchSetting() {
    try {
        const res = await fetch("http://localhost:3024/api/settings");
        const json = await res.json();
        console.log(JSON.stringify(json, null, 2));
    } catch (e) {
        console.error(e);
    }
}
fetchSetting();
