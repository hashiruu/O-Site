import { srtToVtt, shiftVtt, isVtt } from "../lib/subtitle";

describe("字幕转换工具", () => {
    describe("srtToVtt - SRT 转 WebVTT", () => {
        it("应只替换时间戳的逗号，不破坏正文中的逗号", () => {
            const srt = `1
00:00:01,000 --> 00:00:03,500
你好，世界！Hello, world!

2
00:00:04,000 --> 00:00:06,000
第二句，依然有逗号`;
            const vtt = srtToVtt(srt);
            expect(vtt).toContain("00:00:01.000 --> 00:00:03.500");
            expect(vtt).toContain("你好，世界！Hello, world!");
            expect(vtt).toContain("第二句，依然有逗号");
            expect(vtt.startsWith("WEBVTT")).toBe(true);
        });

        it("应去除 BOM 并统一换行符", () => {
            const srt = "﻿1\r\n00:00:01,000 --> 00:00:02,000\r\n测试";
            const vtt = srtToVtt(srt);
            expect(vtt.charCodeAt(0)).not.toBe(0xfeff);
            expect(vtt).not.toContain("\r");
        });

        it("已带 WEBVTT 头的内容不应重复加头", () => {
            const vtt = srtToVtt("WEBVTT\n\n1\n00:00:01,000 --> 00:00:02,000\nhi");
            expect(vtt.match(/WEBVTT/g)?.length).toBe(1);
        });
    });

    describe("shiftVtt - 时间戳平移（HLS -ss 起播对齐）", () => {
        const vtt = `WEBVTT

00:10:00.000 --> 00:10:05.000
第一句

00:10:30.500 --> 00:10:33.000
第二句`;

        it("负偏移应把字幕整体前移", () => {
            const shifted = shiftVtt(vtt, -600); // 前移 10 分钟
            expect(shifted).toContain("00:00:00.000 --> 00:00:05.000");
            expect(shifted).toContain("00:00:30.500 --> 00:00:33.000");
        });

        it("正偏移应把字幕整体后移", () => {
            const shifted = shiftVtt(vtt, 60);
            expect(shifted).toContain("00:11:00.000 --> 00:11:05.000");
        });

        it("平移到负数时应钳制为 0", () => {
            const shifted = shiftVtt(vtt, -700);
            expect(shifted).toContain("00:00:00.000");
            expect(shifted).not.toMatch(/-\d{2}:/); // 不应出现负时间戳
        });

        it("零偏移应原样返回", () => {
            expect(shiftVtt(vtt, 0)).toBe(vtt);
        });

        it("应支持 mm:ss.mmm 短格式时间戳", () => {
            const short = "WEBVTT\n\n01:00.000 --> 01:05.000\nhi";
            const shifted = shiftVtt(short, 30);
            expect(shifted).toContain("00:01:30.000 --> 00:01:35.000");
        });
    });

    describe("isVtt - VTT 格式探测", () => {
        it("应识别 WEBVTT 头", () => {
            expect(isVtt("WEBVTT\n\n...")).toBe(true);
            expect(isVtt("  WEBVTT")).toBe(true);
        });
        it("应拒绝 SRT 内容", () => {
            expect(isVtt("1\n00:00:01,000 --> 00:00:02,000\nhi")).toBe(false);
        });
    });
});
