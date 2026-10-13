import { describe, expect, it } from "vitest";
import { imageMessageContent, imageValidationError, ImageStagingError, stageChatImages } from "./web-chat-images";
import { transcriptMessages } from "./web-chat-state";

describe("Web chat image messages", () => {
  it("restores captions and image refs without duplicate native-vision images or interpreting code examples", () => {
    const quote = String.fromCharCode(96);
    const path = "C:\\Hermes Home\\images\\photo.png";
    const text = "Describe this\n@image:" + quote + path + quote + "\ndata:image/png;base64,aGVsbG8=\n[image]";
    const rows = transcriptMessages([{ role: "user", text, timestamp: 100 }]);
    expect(rows[0].text).toBe("Describe this");
    expect(rows[0].images).toEqual([{ path, name: "photo.png" }]);
    expect(imageMessageContent("@image:/home/images/only.png").text).toBe("");
    expect(imageMessageContent("data:image/png;base64,aGVsbG8=").images).toHaveLength(1);
    const example = quote.repeat(3) + "\n@image:/not/an/attachment.png\n" + quote.repeat(3);
    expect(imageMessageContent(example)).toEqual({ text: example, images: [] });
    expect(imageValidationError({ name: "image.svg", size: 100, type: "image/svg+xml" })).toBe("imageUnsupported");
    expect(imageValidationError({ name: "image.png", size: 26 * 1024 * 1024, type: "image/png" })).toBe("imageTooLarge");
  });

  it("stages selected images in order and rolls back all known paths on an attach failure, including a lost ACK", async () => {
    const files = ["one.png", "two.png"].map((name) => ({ name }) as File);
    const calls: string[] = [];
    let fail = false;
    const host = {
      upload: async (file: File) => {
        calls.push("upload:" + file.name);
        return { path: "/images/" + file.name, name: file.name, bytes: 100, mime_type: "image/png" };
      },
      attach: async (path: string) => {
        calls.push("attach:" + path);
        if (fail && path.endsWith("two.png")) throw new Error("acknowledgement lost");
        return { attached: true };
      },
      detach: async (path: string) => { calls.push("detach:" + path); },
    };
    expect(await stageChatImages(files, host)).toEqual(files.map((file) => ({ path: "/images/" + file.name, name: file.name })));
    expect(calls).toEqual(["upload:one.png", "attach:/images/one.png", "upload:two.png", "attach:/images/two.png"]);
    calls.length = 0;
    fail = true;
    await expect(stageChatImages(files, host)).rejects.toMatchObject({ pendingPaths: [] });
    expect(calls.slice(-2)).toEqual(["detach:/images/one.png", "detach:/images/two.png"]);
    host.detach = async (path: string) => { if (path.endsWith("two.png")) throw new Error("offline"); };
    try { await stageChatImages(files, host); throw new Error("Expected staging to fail"); }
    catch (error) {
      expect(error).toBeInstanceOf(ImageStagingError);
      expect((error as ImageStagingError).pendingPaths).toEqual(["/images/two.png"]);
    }
  });
});
