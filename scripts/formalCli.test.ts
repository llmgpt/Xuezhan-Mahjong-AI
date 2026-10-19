import { describe, expect, it } from "vitest";
import { parseFormalCommand, parseFormalSeedList } from "./formalCli";

describe("正式入口参数只能选择固定执行路径", () => {
  it("接受只读核验、封存、最终审计与显式预约/分片", () => {
    expect(parseFormalCommand(["seal"])).toEqual({ kind: "seal" });
    expect(parseFormalCommand(["verify"])).toEqual({ kind: "verify" });
    expect(parseFormalCommand(["finalize"])).toEqual({ kind: "finalize" });
    expect(parseFormalCommand(["run", "3"])).toEqual({ kind: "run", shard: 3 });
    expect(
      parseFormalCommand(["reserve", "ledger.json", "root", "seeds.json", "4"]),
    ).toEqual({
      kind: "reserve",
      ledgerPath: "ledger.json",
      projectRoot: "root",
      seedsPath: "seeds.json",
      shards: 4,
    });
  });
  it("未知命令、额外参数或服务覆盖参数在读文件或预约前拒绝", () => {
    for (const args of [
      [],
      ["development"],
      ["verify", "anything"],
      ["seal", "--fake-runtime"],
      ["run", "1", "--skip-audit"],
      ["reserve", "a", "b", "c", "1", "extra"],
    ])
      expect(() => parseFormalCommand(args)).toThrow(/用法/);
  });
  it("分片必须为1至8的规范整数，不能隐式截断或接受NaN", () => {
    for (const value of ["0", "9", "1.5", "01", "1e0", "NaN", "-1", " 1", ""])
      expect(() => parseFormalCommand(["run", value])).toThrow(/分片/);
  });
  it("种子文件必须是无重复的32位无符号整数数组", () => {
    expect(parseFormalSeedList([0, 0xffffffff])).toEqual([0, 0xffffffff]);
    for (const value of [
      [],
      [1, 1],
      [-1],
      [0x100000000],
      [1.5],
      ["1"],
      { seeds: [1] },
      null,
    ])
      expect(() => parseFormalSeedList(value)).toThrow(/种子/);
  });
});
