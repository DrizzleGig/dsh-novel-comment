import type { BookSearch, ChapterFetch, SearchResult, SourceAdapter } from "./source.ts";
import { SourceStopError } from "./source.ts";
import type { RawComment } from "./comments.ts";
import { sha256Hex } from "./hash.ts";

interface FakeBook {
  book: {
    bookId: string;
    title: string;
    author: string;
    tags: string[];
    summary: string;
  };
  chapters: Array<{ chapterId: string; sequenceNumber: number; title: string; content: string }>;
  comments: RawComment[];
}

const DEMO_BOOKS: FakeBook[] = [
  {
    book: {
      bookId: "fake-sys-1",
      title: "我在末日开系统",
      author: "老K",
      tags: ["末世", "系统流", "升级", "快节奏", "爽文"],
      summary: "末世第十年，主角突然收到一个每日签到的系统。",
    },
    chapters: [
      {
        chapterId: "c1",
        sequenceNumber: 1,
        title: "第一章 签到",
        content: "天亮了。\n\n林越从防空洞的阴影里坐起来，脑子里多了一行字：今日签到已刷新。\n\n他盯着那行字看了三秒，笑了。",
      },
      {
        chapterId: "c2",
        sequenceNumber: 2,
        title: "第二章 第一箱物资",
        content: "签到的奖励是一个铁箱。\n\n箱子里有半箱压缩饼干和一把还能用的匕首。林越把匕首插进腰带，出门前回头看了一眼那行字。",
      },
    ],
    comments: [
      { text: "这个系统设定有点意思，追了", likes: 12, paragraphIndex: 1 },
      { text: "节奏真快，第一章就给东西", likes: 8 },
      { text: "希望别写崩，末世文太容易崩了", likes: 5 },
      { text: "笑死，主角心真大", likes: 3 },
    ],
  },
  {
    book: {
      bookId: "fake-emotion-1",
      title: "旧信",
      author: "南枝",
      tags: ["都市", "单女主", "慢热", "甜宠", "描写细腻"],
      summary: "她整理旧物时翻出一封没寄出的信。",
    },
    chapters: [
      {
        chapterId: "c1",
        sequenceNumber: 1,
        title: "第一章 抽屉",
        content: "搬家那天，她在最底层的抽屉里摸到一个牛皮纸信封。\n\n信没有寄出，邮戳的位置空着。她坐在地板上，读了三行，又折回去重新读。",
      },
    ],
    comments: [
      { text: "这段写得好细，心动", likes: 21, paragraphIndex: 1 },
      { text: "慢热但好看，作者文笔在线", likes: 9 },
      { text: "男主要快点出场啊", likes: 4 },
    ],
  },
  {
    book: {
      bookId: "fake-plot-1",
      title: "第七码头",
      author: "老K",
      tags: ["悬疑", "探案", "伏笔密集", "考据", "群像"],
      summary: "码头接连失踪的船员，和二十年前的一桩旧案有关。",
    },
    chapters: [
      {
        chapterId: "c1",
        sequenceNumber: 1,
        title: "第一章 空船",
        content: "船是空的。\n\n第七码头的人说，昨夜没有船靠岸，可甲板上的水迹还没干。老周蹲下去，用手指抹了一把，闻了闻。",
      },
    ],
    comments: [
      { text: "伏笔埋得真密，我记了三条", likes: 15, paragraphIndex: 1 },
      { text: "这个细节考据很细，不像瞎写", likes: 7 },
      { text: "节奏偏慢，但逻辑在线", likes: 3 },
    ],
  },
  {
    book: {
      bookId: "fake-harem-1",
      title: "长安十二楼",
      author: "青衫",
      tags: ["历史", "多女主", "后宫", "轻松搞笑", "爽文"],
      summary: "穿越到长安，开局一间酒楼，客人全是麻烦。",
    },
    chapters: [
      {
        chapterId: "c1",
        sequenceNumber: 1,
        title: "第一章 开局一间破楼",
        content: "长安城东，十二楼倒了十一楼。\n\n剩下那一楼里，坐着三个不肯走的姑娘和一个不肯结账的客人。",
      },
    ],
    comments: [
      { text: "好笑，节奏也快", likes: 18 },
      { text: "后宫向，先观望", likes: 2 },
    ],
  },
];

/**
 * 确定性的假书源：不联网，用在测试与演示里。
 * 行为与真书源一致：搜索 → 读章 → 读评论；到第 3 章之后返回「站点结构变化」的停止原因示例。
 */
export class FakeSource implements SourceAdapter {
  readonly id = "fake";
  readonly capabilities = { search: true, readChapter: true, readComments: true };
  private readonly books: FakeBook[];

  constructor(books: FakeBook[] = DEMO_BOOKS) {
    this.books = books;
  }

  async search(query: BookSearch, _signal?: AbortSignal): Promise<SearchResult[]> {
    const text = (query.text ?? "").toLowerCase();
    const tags = new Set(query.tags ?? []);
    const limit = query.limit ?? 10;
    return this.books
      .filter((entry) => {
        if (text && !`${entry.book.title} ${entry.book.author}`.toLowerCase().includes(text)) return false;
        if (tags.size > 0 && !entry.book.tags.some((t) => tags.has(t))) return false;
        return true;
      })
      .slice(0, limit)
      .map((entry) => ({ book: entry.book, sourceId: this.id, sourceSite: "fake.local" }));
  }

  async fetchChapter(bookId: string, chapterId: string, _signal?: AbortSignal): Promise<ChapterFetch> {
    const entry = this.books.find((b) => b.book.bookId === bookId);
    if (!entry) throw new SourceStopError("temporarily_unavailable", `书不存在：${bookId}`);
    if (chapterId === "c3") throw new SourceStopError("layout_changed", "演示：站点结构变化，读不到这一章");
    const chapter = entry.chapters.find((c) => c.chapterId === chapterId);
    if (!chapter) throw new SourceStopError("paywall", "演示：这一章需要付费解锁");
    return {
      bookId,
      chapterId,
      sequenceNumber: chapter.sequenceNumber,
      title: chapter.title,
      content: chapter.content,
      contentHash: sha256Hex(chapter.content),
    };
  }

  async fetchComments(bookId: string, chapterId: string, _signal?: AbortSignal): Promise<RawComment[]> {
    const entry = this.books.find((b) => b.book.bookId === bookId);
    return entry?.comments ?? [];
  }
}
