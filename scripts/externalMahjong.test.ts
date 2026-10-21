import { afterEach, describe, expect, it } from "vitest";
import { createGame } from "../src/game/game";
import { playerView } from "../src/game/view";
import {
  ExternalMahjongWorker,
  type ExternalMahjongOptions,
} from "./externalMahjong";

const workers: ExternalMahjongWorker[] = [];
const input = () => {
  const state = createGame(104);
  state.phase = "discard";
  for (const player of state.players) player.missing = "tong";
  return playerView(state, 0);
};

function fake(
  body: string,
  timeoutMs = 3000,
  policy?: ExternalMahjongOptions["policy"],
) {
  const worker = new ExternalMahjongWorker({
    executable: process.execPath,
    args: [
      "--input-type=module",
      "-e",
      `
      import { createInterface } from 'node:readline';
      const lines = createInterface({input: process.stdin});
      lines.on('line', line => {
        const request = JSON.parse(line);
        ${body}
      });
    `,
    ],
    timeoutMs,
    policy,
  });
  workers.push(worker);
  return worker;
}

afterEach(async () => {
  await Promise.all(workers.splice(0).map((worker) => worker.close()));
});

describe("独立 Python 策略的常驻协议边界", () => {
  it("公开动作来源必须是座位标量，不能经from字段夹带对象", () => {
    const worker = fake("throw new Error('must not send');");
    const view = input();
    view.publicActions!.push({ seat: 1, kind: "pung", tile: 8, from: 0 });
    Object.assign(view.publicActions![0], { from: { hand: [1, 2, 3] } });
    expect(() => worker.act(view, "discard")).toThrow(/来源|from/);
  });
  it("公开摸牌历史不能夹带暗牌，未知历史字段在发送前拒绝", () => {
    const worker = fake("throw new Error('must not send');");
    const view = input();
    view.publicActions!.push({ seat: 1, kind: "draw" });
    Object.assign(view.publicActions![0], { tile: 8 });
    expect(() => worker.act(view, "discard")).toThrow(/tile|未允许|隐藏/);
  });

  it.each([
    "ebony72-advanced-public-v1",
    "ebony72-advanced-cap8-discard-v1",
    "ebony72-advanced-current-income-v1",
    "ebony72-advanced-ready-income-v1",
    "fanfou-ba-composite-v1",
  ] as const)(
    "高级参考%s显式发送policy标识，缺失历史直接失败",
    async (policy) => {
      const worker = fake(
        `
      if(request.policy!=='${policy}') throw new Error('wrong policy');
      console.log(JSON.stringify({id:request.id,action:{type:'discard',tile:request.view.legalDiscards[0]}}));
    `,
        3000,
        policy,
      );
      const view = input();
      expect(await worker.act(view, "discard")).toEqual({
        type: "discard",
        tile: view.legalDiscards[0],
      });
      delete view.publicActions;
      expect(() => worker.act(view, "discard")).toThrow(/历史|publicActions/);
      await expect(worker.finish()).resolves.toBeUndefined();
    },
  );
  it("同一子进程处理多次请求，不传种子、牌墙或对手暗牌", async () => {
    const worker = fake(`
      if ('seed' in request || 'seed' in request.view || 'wall' in request.view ||
          request.view.opponents.some(p => 'hand' in p)) throw new Error('hidden data');
      console.log(JSON.stringify({id: request.id, action: {
        type: 'discard', tile: request.view.legalDiscards[0]
      }}));
    `);
    const view = input();
    const first = await worker.act(view, "discard");
    expect(first).toEqual({ type: "discard", tile: view.legalDiscards[0] });
    expect(await worker.act(view, "discard")).toEqual(first);
  });

  it("拒绝把完整状态或对手暗牌意外塞入公开投影", async () => {
    const worker = fake("console.log('request should not be sent');");
    expect(() =>
      worker.act(Object.assign(input(), { seed: 3 }), "discard"),
    ).toThrow(/公开|seed|隐藏/);
    const view = input();
    Object.assign(view.opponents[0], { hand: [1, 2, 3] });
    expect(() => worker.act(view, "discard")).toThrow(/暗牌|隐藏|hand/);
  });

  it("缺少真实公开时序时直接失败，不伪造弃牌顺序", () => {
    const worker = fake("console.log('request should not be sent');");
    const view = input();
    delete view.publicTiles;
    expect(() => worker.act(view, "discard")).toThrow(/时序|publicTiles/);
  });

  it("拒绝来源 ID 不匹配的回复", async () => {
    const worker = fake(
      "console.log(JSON.stringify({id:'unknown',action:{type:'win'}}));",
    );
    await expect(worker.act(input(), "discard")).rejects.toThrow(/ID|id|协议/);
  });

  it("拒绝 stdout 中混入的非协议内容", async () => {
    const worker = fake("console.log('debug output');");
    await expect(worker.act(input(), "discard")).rejects.toThrow(/JSON|协议/);
  });

  it("外部异常明确暴露，不回退内部老师", async () => {
    const worker = fake(
      "console.log(JSON.stringify({id:request.id,error:'No preferable discard'}));",
    );
    await expect(worker.act(input(), "discard")).rejects.toThrow(
      "No preferable discard",
    );
  });

  it("外部返回不在合法集合的动作时失败", async () => {
    const worker = fake(
      "console.log(JSON.stringify({id:request.id,action:{type:'discard',tile:99}}));",
    );
    await expect(worker.act(input(), "discard")).rejects.toThrow(/合法/);
  });

  it("策略卡住时超时并终止会话，不能继续用迟到结果", async () => {
    const worker = fake("void request;", 80);
    await expect(worker.act(input(), "discard")).rejects.toThrow(/超时/);
    await expect(worker.act(input(), "discard")).rejects.toThrow(/关闭|终止/);
  });

  it("子进程提前退出时立即报告，不悬挂整个评测", async () => {
    const worker = fake("process.exit(2);");
    await expect(worker.act(input(), "discard")).rejects.toThrow(/退出/);
  });

  it("最后一个合法回复后异常退出，finish仍失败而cleanup不覆盖原错误", async () => {
    const worker = fake(`
      process.stdout.write(JSON.stringify({id:request.id,action:{
        type:'discard',tile:request.view.legalDiscards[0]
      }})+String.fromCharCode(10),()=>process.exit(2));
    `);
    await expect(worker.act(input(), "discard")).resolves.toMatchObject({
      type: "discard",
    });
    await expect(worker.finish()).rejects.toThrow(/退出.*code=2/);
    await expect(worker.close()).resolves.toBeUndefined();
    await expect(worker.finish()).rejects.toThrow(/退出.*code=2/);
  });

  it("最后一个合法回复后混入协议垃圾，finish不能把本局算作成功", async () => {
    const worker = fake(`
      console.log(JSON.stringify({id:request.id,action:{
        type:'discard',tile:request.view.legalDiscards[0]
      }}));
      console.log('late debug output');
    `);
    await expect(worker.act(input(), "discard")).resolves.toMatchObject({
      type: "discard",
    });
    await expect(worker.finish()).rejects.toThrow(/JSON|协议/);
    await expect(worker.close()).resolves.toBeUndefined();
  });

  it("finish给stdin EOF，等待正常code0退出并禁止后续请求", async () => {
    const worker = fake(`
      console.log(JSON.stringify({id:request.id,action:{
        type:'discard',tile:request.view.legalDiscards[0]
      }}));
    `);
    await worker.act(input(), "discard");
    await expect(worker.finish()).resolves.toBeUndefined();
    await expect(worker.finish()).resolves.toBeUndefined();
    await expect(worker.act(input(), "discard")).rejects.toThrow(
      /关闭|终止|结束/,
    );
    await expect(worker.close()).resolves.toBeUndefined();
  });

  it("finish允许已发送请求排空，不在最后回复前强杀进程", async () => {
    const worker = fake(`
      setTimeout(()=>console.log(JSON.stringify({id:request.id,action:{
        type:'discard',tile:request.view.legalDiscards[0]
      }})),20);
    `);
    const action = worker.act(input(), "discard");
    const finished = worker.finish();
    await expect(Promise.all([action, finished])).resolves.toEqual([
      { type: "discard", tile: input().legalDiscards[0] },
      undefined,
    ]);
  });

  it("EOF后仍不退出时finish超时杀进程，不能悬挂评测收尾", async () => {
    const worker = fake(
      `
      console.log(JSON.stringify({id:request.id,action:{
        type:'discard',tile:request.view.legalDiscards[0]
      }}));
      setInterval(()=>{},1000);
    `,
      1000,
    );
    await worker.act(input(), "discard");
    await expect(worker.finish()).rejects.toThrow(/结束|收尾|finish|超时/);
    await expect(worker.close()).resolves.toBeUndefined();
    await expect(worker.act(input(), "discard")).rejects.toThrow(/关闭|终止/);
  });

  it("记录首个外部错误，cleanup后finish仍返回原错误", async () => {
    const worker = fake(
      "console.log(JSON.stringify({id:request.id,error:'first worker error'}));",
    );
    await expect(worker.act(input(), "discard")).rejects.toThrow(
      "first worker error",
    );
    await expect(worker.close()).resolves.toBeUndefined();
    await expect(worker.finish()).rejects.toThrow("first worker error");
  });
});
