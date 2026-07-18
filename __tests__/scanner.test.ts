import { cleanTitle, parseEpisode } from "../lib/scanner";

describe("测试 Scanner 核心字符解析引擎", () => {
    describe("cleanTitle - 智能剧集命清洗", () => {
        it("应移除常见的基础扩展名", () => {
            expect(cleanTitle("movie.mp4")).toBe("movie");
            expect(cleanTitle("episode.mkv")).toBe("episode");
        });

        it("应剔除所有蓝光、压制组及分辨率标签 (720p, 1080p, x264等)", () => {
            expect(cleanTitle("Avengers.2012.1080p.BluRay.x264.DTS")).toBe("Avengers 2012");
            expect(cleanTitle("Iron.Man.720p.WEB-DL.AAC.mp4")).toBe("Iron Man");
        });

        it("应自动无视各种中括号包裹的发布组声明", () => {
            expect(cleanTitle("[SubsPlease] Anime Name - 01 (1080p).mkv")).toBe("Anime Name - 01");
            expect(cleanTitle("【喵萌奶茶屋】★04月新番★[吹响！上低音号][01][1080p][繁日双语]")).toBe("04月新番 吹响！上低音号 01 繁日双语");
        });

        it("应将底杠与点号替换为空格", () => {
            expect(cleanTitle("My_Favorite_Movie.2023.mp4")).toBe("My Favorite Movie 2023");
        });
    });

    describe("parseEpisode - 集数正则嗅探提取", () => {
        it("能够解析正规美剧标准的 SxxExx 序列", () => {
            expect(parseEpisode("Show.S01E05.1080p.mkv")).toEqual({ season: 1, episode: 5 });
            expect(parseEpisode("s2e10.mp4")).toEqual({ season: 2, episode: 10 });
        });

        it("能够提取仅含 EP/ep 标记的单季动漫集数", () => {
            expect(parseEpisode("Anime EP01.mkv")).toEqual({ season: 1, episode: 1 });
            expect(parseEpisode("ep12.mp4")).toEqual({ season: 1, episode: 12 });
        });

        it("处理中文汉字：第XX集 / 第XX话", () => {
            expect(parseEpisode("某动漫 第08集.mkv")).toEqual({ season: 1, episode: 8 });
            expect(parseEpisode("某动漫 第12话.mkv")).toEqual({ season: 1, episode: 12 });
        });

        it("兼容破折号夹紧的粗略命名风格 (- 01 -)", () => {
            expect(parseEpisode("Anime Name - 03 - 720p.mkv")).toEqual({ season: 1, episode: 3 });
        });

        it("未知格式的电影名应该反馈为默认的安全界限 S1 E0", () => {
            expect(parseEpisode("Interstellar 2014.mkv")).toEqual({ season: 1, episode: 0 });
        });
    });
});
