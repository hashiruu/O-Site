// 精选舞台音乐剧（stage musical）清单——百老汇/西区/官摄。
// 不是"带音乐的影视剧"：Hamilton、歌剧魅影、悲惨世界（舞台版）这类。
// TMDB 没有舞台音乐剧分类（10402 是音乐题材电影/歌舞片，混入大量演唱会电影与纪录片），
// 所以 musical 体系的数据源是这份 curated 清单，海报按英文名去 TMDB search 借影视版/官摄版封面。
// 清单可随时增补；id 用英文 slug 做稳定主键（去重、入库）。

export interface Musical {
    id: string;        // slug
    title: string;     // 中文译名
    en: string;        // 英文原名（TMDB 搜海报 + 外站搜索更准）
    year: number;      // 首演年
    overview: string;  // 一句话中文简介
}

export const MUSICALS: Musical[] = [
    { id: "hamilton", title: "汉密尔顿", en: "Hamilton", year: 2015, overview: "用嘻哈与说唱讲美国国父亚历山大·汉密尔顿的一生，革命性的当代史诗。" },
    { id: "phantom", title: "歌剧魅影", en: "The Phantom of the Opera", year: 1986, overview: "巴黎歌剧院地下的神秘魅影痴恋女高音克里斯汀，韦伯最经典的永恒之作。" },
    { id: "les-mis", title: "悲惨世界", en: "Les Misérables", year: 1985, overview: "雨果小说改编，法国革命浪潮中冉阿让的救赎之路，宏大的群像悲歌。" },
    { id: "lion-king", title: "狮子王", en: "The Lion King", year: 1997, overview: "迪士尼动画搬上舞台，非洲草原的木偶与面具奇观，常青不衰。" },
    { id: "wicked", title: "魔法坏女巫", en: "Wicked", year: 2003, overview: "《绿野仙踪》反派女巫的前传，绿色皮肤的艾尔法芭如何被误解为恶。" },
    { id: "chicago", title: "芝加哥", en: "Chicago", year: 1975, overview: "1920年代两名女杀人犯靠丑闻登上头条，爵士风味的黑色讽刺。" },
    { id: "cats", title: "猫", en: "Cats", year: 1981, overview: "艾略特诗作改编，杰里科猫族一夜聚会选登天，韦伯的记忆之歌传世。" },
    { id: "rent", title: "吉屋出租", en: "Rent", year: 1996, overview: "纽约东村一群艺术家的爱与病痛，改编自《波西米亚人》，摇滚激情。" },
    { id: "dear-evan-hansen", title: "致埃文·汉森", en: "Dear Evan Hansen", year: 2015, overview: "一个善意的谎言如何被当成慰藉，孤独少年的当代心理剧。" },
    { id: "sweeney-todd", title: "理发师陶德", en: "Sweeney Todd", year: 1979, overview: "被冤枉的理发师复仇归来，与楼下肉饼铺老板娘的暗黑血色桑德海姆经典。" },
    { id: "book-of-mormon", title: "摩门经", en: "The Book of Mormon", year: 2011, overview: "两个摩门教传教士去乌干达，南公园 creators 的爆笑与温情。" },
    { id: "come-from-away", title: "来自远方", en: "Come From Away", year: 2015, overview: "911 后 38 架航班迫降加拿大小镇，真实事件里的人性暖光。" },
    { id: "six", title: "六位皇后", en: "Six the Musical", year: 2017, overview: "亨利八世的六位妻子组成女子流行组合夺回叙事权，炸场演唱会式。" },
    { id: "hadestown", title: "哈迪斯城", en: "Hadestown", year: 2019, overview: "俄耳甫斯下冥府救妻的希腊神话，民谣爵士交织的诗意重构。" },
    { id: "into-the-woods", title: "拜访森林", en: "Into the Woods", year: 1987, overview: "童话角色走进同一片森林许愿，愿望实现后却各有代价。" },
    { id: "next-to-normal", title: "近乎正常", en: "Next to Normal", year: 2008, overview: "患双相障碍的母亲与家庭，摇滚音乐剧直面心理疾病。" },
    { id: "spring-awakening", title: "春之觉醒", en: "Spring Awakening", year: 2006, overview: "19世纪德国少年的性启蒙与压抑， indie rock 翻新经典。" },
    { id: "last-five-years", title: "过去五年", en: "The Last Five Years", year: 2001, overview: "一段婚姻从相恋到破裂，男方顺叙、女方倒叙的双线独白。" },
    { id: "chorus-line", title: "歌舞线上", en: "A Chorus Line", year: 1975, overview: "百老汇群舞演员的试镜与人生自白，献给台后的无名英雄。" },
    { id: "west-side-story", title: "西区故事", en: "West Side Story", year: 1957, overview: "纽约 Jets 与 Sharks 两帮派之恋，莎士比亚式罗密欧与朱丽叶。" },
    { id: "sound-of-music", title: "音乐之声", en: "The Sound of Music", year: 1959, overview: "修女玛丽亚成为特拉普家庭教师，二战前夕奥地山的爱与离别。" },
    { id: "my-fair-lady", title: "窈窕淑女", en: "My Fair Lady", year: 1956, overview: "语音学教授把卖花女改造成淑女，萧伯纳《皮格马利翁》改编。" },
    { id: "king-and-i", title: "国王与我", en: "The King and I", year: 1951, overview: "英国女教师赴暹罗王室任教，东西方文化的碰撞与情谊。" },
    { id: "fiddler-on-the-roof", title: "屋顶上的提琴手", en: "Fiddler on the Roof", year: 1964, overview: "俄国犹太村落牛奶工为女儿们张罗婚事，传统在时代里动摇。" },
    { id: "cabaret", title: "歌厅", en: "Cabaret", year: 1966, overview: "魏玛共和国柏林夜总会， decadence 之下纳粹阴影渐近。" },
    { id: "jesus-christ-superstar", title: "万世巨星", en: "Jesus Christ Superstar", year: 1971, overview: "摇滚乐讲述耶稣受难最后七天，犹大视角的韦伯名作。" },
    { id: "evita", title: "艾薇塔", en: "Evita", year: 1978, overview: "阿根廷贝隆夫人从底层到第一夫人的传奇一生。" },
    { id: "mamma-mia", title: "妈妈咪呀", en: "Mamma Mia!", year: 1999, overview: "希腊小岛婚礼前夜，女儿偷请三位可能是父亲的旧友，ABBA 金曲串联。" },
    { id: "beauty-and-the-beast", title: "美女与野兽", en: "Beauty and the Beast", year: 1994, overview: "迪士尼动画的舞台版，被诅咒的王子与懂书女孩的相爱。" },
    { id: "mary-poppins", title: "欢乐满人间", en: "Mary Poppins", year: 2004, overview: "神奇的保姆来到班克斯家，重拾童真与家庭温度。" },
    { id: "aladdin", title: "阿拉丁", en: "Aladdin", year: 2011, overview: "迪士尼舞台版，街头小子与神灯精灵，缤纷的阿拉伯奇想。" },
    { id: "matilda", title: "玛蒂尔达", en: "Matilda the Musical", year: 2010, overview: "天才小女孩对抗恶校长特朗奇布尔，蒂姆·明钦的机灵词曲。" },
    { id: "billy-elliot", title: "舞动人生", en: "Billy Elliot the Musical", year: 2005, overview: "矿工之子偷偷学芭蕾，埃尔顿·约翰作曲的英伦励志作。" },
    { id: "kinky-boots", title: "长靴皇后", en: "Kinky Boots", year: 2012, overview: "濒临倒闭的鞋厂转型做变装靴，赛琳娜·迪翁作曲的温暖宣言。" },
    { id: "hairspray", title: "发胶星梦", en: "Hairspray", year: 2002, overview: "1960年代巴尔的摩胖女孩想上电视舞蹈秀，种族与身材的平权喜剧。" },
    { id: "little-shop", title: "异形奇花", en: "Little Shop of Horrors", year: 1982, overview: "花店伙计养出一株要吃人的怪植物奥黛丽二世，黑色幽默 B 级片风。" },
    { id: "company", title: "伙伴们", en: "Company", year: 1970, overview: "恐婚的鲍比旁观五对朋友的婚姻，桑德海姆概念音乐剧里程碑。" },
    { id: "miss-saigon", title: "西贡小姐", en: "Miss Saigon", year: 1989, overview: "越战末期西贡酒吧女与美军的爱与离散，《蝴蝶夫人》式悲剧。" },
    { id: "starlight-express", title: "星光快车", en: "Starlight Express", year: 1984, overview: "演员踩旱冰鞋扮演火车头竞赛，韦伯的奇观式家庭剧。" },
    { id: "sunset-boulevard", title: "日落大道", en: "Sunset Boulevard", year: 1993, overview: "默片时代的过气女星诺玛妄想复出，好莱坞黄金梦的凋零。" },
    { id: "avenue-q", title: "Q 大道", en: "Avenue Q", year: 2003, overview: "成人布偶在纽约破街区找工作与爱情，毒舌又真诚的 Sesame 恶搞。" },
    { id: "heathers", title: "希瑟斯", en: "Heathers the Musical", year: 2014, overview: "高中女生卷入神秘转学生的连环复仇，黑色摇滚校园剧。" },
    { id: "beetlejuice", title: "阴间大法师", en: "Beetlejuice the Musical", year: 2019, overview: "鬼魂夫妇与驱鬼骗子的荒诞交易，改编自蒂姆·伯顿电影。" },
    { id: "waitress", title: "女服务员", en: "Waitress", year: 2015, overview: "做派的南方女服务员想逃离不幸婚姻，烘焙与重生的温暖故事。" },
    { id: "frozen", title: "冰雪奇缘", en: "Frozen the Musical", year: 2018, overview: "迪士尼舞台版，艾莎与安娜姐妹情，Let It Go 的现场震撼。" },
    { id: "color-purple", title: "紫色", en: "The Color Purple", year: 2005, overview: "20世纪初非裔女性西莉的苦难与觉醒，灵歌与爵士的力量。" },
    { id: "pippin", title: "皮平", en: "Pippin", year: 1972, overview: "查理大帝之子寻找人生意义，杂技团式的魔幻叙事。" },
    { id: "city-of-angels", title: "天使之城", en: "City of Angels", year: 1989, overview: "编剧的小说世界与现实交错，黑白侦探片与彩色好莱坞的双线。" },
];
