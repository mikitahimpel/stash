import { describe, expect, it } from "@effect/vitest";
import * as Testing from "@stash/backend-platform/testing";
import * as Errors from "@stash/contracts-domain/errors";
import * as Link from "@stash/contracts-domain/link";
import * as Tag from "@stash/contracts-domain/tag";
import * as Effect from "effect/Effect";
import * as DeleteLink from "../src/details/delete-link.ts";
import * as GetLink from "../src/details/get-link.ts";
import * as UpdateLink from "../src/details/update-link.ts";
import * as ListLinks from "../src/list/list-links.ts";
import * as SaveLink from "../src/save/save-link.ts";
import * as LinksTestLayer from "./links-test-layer.ts";

// Two users (#177): the owner and a member. Nothing one of them stores is visible to, or
// changeable by, the other. All data is synthetic.

const url = (value: string) => Link.Url.make(value);
const asMember = Testing.as(Testing.member);
const publishedTo = (userId: string) =>
  Effect.flatMap(Testing.TestLinkEvents, (events) => events.publishedTo(userId));

describe("links of two users", () => {
  it.effect("each user saves the same URL as their own link", () =>
    Effect.gen(function* () {
      const input = { url: url("https://example.com/shared?utm_source=x") };
      const mine = yield* SaveLink.saveLink(LinksTestLayer.user, input);
      const theirs = yield* SaveLink.saveLink(LinksTestLayer.user, input).pipe(asMember);
      // Dedupe is per user: the member's save is new, not the owner's link handed over.
      expect(theirs.created).toBe(true);
      expect(theirs.id).not.toBe(mine.id);
      expect(theirs.canonicalUrl).toBe(mine.canonicalUrl);
      // And still per user: the member's second save finds the member's own link.
      const again = yield* SaveLink.saveLink(LinksTestLayer.user, input).pipe(asMember);
      expect(again).toMatchObject({ id: theirs.id, created: false });
    }).pipe(Effect.provide(LinksTestLayer.layer())),
  );

  it.effect("a user lists and finds only their own links", () =>
    Effect.gen(function* () {
      const mine = yield* SaveLink.saveLink(LinksTestLayer.user, {
        url: url("https://example.com/owner"),
        tags: [Tag.TagName.make("shared-tag")],
      });
      const theirs = yield* SaveLink.saveLink(LinksTestLayer.user, {
        url: url("https://example.com/member"),
        tags: [Tag.TagName.make("shared-tag")],
      }).pipe(asMember);

      const ownerList = yield* ListLinks.listLinks({});
      expect(ownerList.items.map((link) => link.id)).toEqual([mine.id]);
      const memberList = yield* ListLinks.listLinks({}).pipe(asMember);
      expect(memberList.items.map((link) => link.id)).toEqual([theirs.id]);
      // The tag name is shared, the tagged links are not.
      const byTag = yield* ListLinks.listLinks({ tag: Tag.TagName.make("shared-tag") }).pipe(
        asMember,
      );
      expect(byTag.items.map((link) => link.id)).toEqual([theirs.id]);
      // Not by id, not by URL.
      const byIds = yield* ListLinks.listLinks({ ids: [mine.id, theirs.id] }).pipe(asMember);
      expect(byIds.items.map((link) => link.id)).toEqual([theirs.id]);
      const byUrl = yield* ListLinks.listLinks({ url: url("https://example.com/owner") }).pipe(
        asMember,
      );
      expect(byUrl.items).toEqual([]);
    }).pipe(Effect.provide(LinksTestLayer.layer())),
  );

  it.effect("another user's link is NotFound to get, patch and delete, and stays as it was", () =>
    Effect.gen(function* () {
      const { created: _, ...mine } = yield* SaveLink.saveLink(LinksTestLayer.user, {
        url: url("https://example.com/private"),
        title: "Private",
      });
      const notFound = new Errors.NotFound({ resource: "link", id: mine.id });
      expect(yield* GetLink.getLink(mine.id).pipe(asMember, Effect.flip)).toEqual(notFound);
      expect(
        yield* UpdateLink.updateLink(mine.id, {
          title: "Taken over",
          status: "archived",
          tags: [Tag.TagName.make("intruder")],
        }).pipe(asMember, Effect.flip),
      ).toEqual(notFound);
      expect(yield* DeleteLink.deleteLink(mine.id).pipe(asMember, Effect.flip)).toEqual(notFound);
      expect(yield* GetLink.getLink(mine.id)).toMatchObject({
        id: mine.id,
        title: "Private",
        status: "new",
        tags: [],
      });
    }).pipe(Effect.provide(LinksTestLayer.layer())),
  );

  it.effect("a save is announced on its user's stream only", () =>
    Effect.gen(function* () {
      const mine = yield* SaveLink.saveLink(LinksTestLayer.user, {
        url: url("https://example.com/owner-event"),
      });
      const theirs = yield* SaveLink.saveLink(LinksTestLayer.user, {
        url: url("https://example.com/member-event"),
      }).pipe(asMember);
      yield* UpdateLink.updateLink(theirs.id, { status: "seen" }).pipe(asMember);
      yield* DeleteLink.deleteLink(theirs.id).pipe(asMember);

      const ownerEvents = yield* publishedTo(Testing.owner.id);
      expect(ownerEvents.map((event) => event.type)).toEqual(["link.updated"]);
      expect(ownerEvents[0]).toMatchObject({ link: { id: mine.id } });
      const memberEvents = yield* publishedTo(Testing.member.id);
      expect(memberEvents.map((event) => event.type)).toEqual([
        "link.updated",
        "link.updated",
        "link.deleted",
      ]);
      expect(JSON.stringify(memberEvents)).not.toContain(mine.id);
      expect(JSON.stringify(ownerEvents)).not.toContain(theirs.id);
    }).pipe(Effect.provide(LinksTestLayer.layer())),
  );

  it.effect("a save cannot be attributed to another user's device", () =>
    Effect.gen(function* () {
      // The member names the owner's device: the link is saved, without a source device, and the
      // owner's device records no save.
      const saved = yield* SaveLink.saveLink(LinksTestLayer.user, {
        url: url("https://example.com/attributed"),
        deviceId: LinksTestLayer.deviceId,
      }).pipe(asMember);
      expect(saved.sourceDeviceId).toBeNull();
      const own = yield* SaveLink.saveLink(LinksTestLayer.user, {
        url: url("https://example.com/attributed-own"),
        deviceId: LinksTestLayer.memberDeviceId,
      }).pipe(asMember);
      expect(own.sourceDeviceId).toBe(LinksTestLayer.memberDeviceId);
    }).pipe(Effect.provide(LinksTestLayer.layer())),
  );
});
