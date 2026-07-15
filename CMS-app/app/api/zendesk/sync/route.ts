import { NextRequest, NextResponse } from "next/server";
import { setRequestProject } from "@/lib/request-context";
import { getRequestUser, forbidden } from "@/lib/server-auth";
import { canPublish } from "@/lib/permissions";
import { NO_STORE } from "@/lib/api-cache";
import { getToc } from "@/lib/content";
import { getFile, getFileBytes } from "@/lib/storage";
import { compileArticle, createSnippetCache } from "@/lib/compile";
import { rewriteAssetUrls } from "@/lib/site-bundle";
import { loadZendeskMap, saveZendeskMap } from "@/lib/zendesk-map";
import { reconcile } from "@/lib/zendesk-reconcile";
import {
  getZendeskConfig, listCategories, listSections,
  createCategory, createSection, createArticle, updateArticle, uploadAttachment,
} from "@/lib/zendesk";
import {
  articlesWithSectionPaths, buildSyncPlan, executeSync, hashArticle, planFromMap,
  type SyncArticle, type ZendeskWriter,
} from "@/lib/zendesk-sync";

/**
 * POST /api/zendesk/sync   Body: { dryRun?: boolean, activeTags?: string[] }
 *
 * Push the project's TOC + articles INTO Zendesk, publishing articles live.
 *
 *   dryRun: true  — no Zendesk call at all. Plans from the confirmed map and
 *                   returns what WOULD happen (create/update/skip/blocked).
 *   dryRun: false — reconciles against the live help centre (so the confirm-guard
 *                   can catch an unconfirmed name-match that would duplicate),
 *                   then creates structure and publishes articles, writing every
 *                   new id back to the map as it goes.
 *
 * canPublish-gated. This is the one route in the system that writes to a live
 * customer-facing help centre.
 */
export async function POST(request: NextRequest) {
  await setRequestProject(request);
  const user = await getRequestUser(request);
  if (!canPublish(user?.role ?? null)) return forbidden("You don't have permission to publish");

  try {
    const { dryRun, activeTags } = (await request.json().catch(() => ({}))) as {
      dryRun?: boolean;
      activeTags?: string[];
    };
    const tags = Array.isArray(activeTags) && activeTags.length ? activeTags : undefined;

    const map = await loadZendeskMap();
    const toc = await getToc();
    const { filed, unfiled } = articlesWithSectionPaths(toc);

    // Compile every filed article once: body (for sync) + its images + a content
    // hash (unchanged hash ⇒ the sync skips it).
    const cache = createSnippetCache();
    const articles: SyncArticle[] = [];
    for (const a of filed) {
      try {
        const file = await getFile(`content/${a.file}`);
        const { html } = await compileArticle(file.content, undefined, cache, tags);
        const { assets } = rewriteAssetUrls(html);
        articles.push({ ...a, body: html, assets, hash: hashArticle(a.title, html) });
      } catch {
        // Unreadable body — leave it out; it surfaces as blocked (no op planned).
      }
    }

    if (dryRun) {
      const plan = buildSyncPlan(planFromMap(toc, map), map, articles, unfiled);
      return NextResponse.json({ dryRun: true, plan }, { headers: NO_STORE });
    }

    // Live: reconcile against Zendesk for the confirm-guard, then execute.
    const cfg = getZendeskConfig();
    const locale = map.locale || "en-us";
    const [categories, sections] = await Promise.all([
      listCategories(cfg, locale),
      listSections(cfg, locale),
    ]);
    const recon = reconcile(toc, { categories, sections }, map);

    const writer: ZendeskWriter = {
      createCategory: (name, description) => createCategory(cfg, locale, { name, description }),
      createSection: (name, categoryId, parentSectionId) => createSection(cfg, locale, { name, categoryId, parentSectionId }),
      createArticle: (sectionId, a) => createArticle(cfg, locale, sectionId, a),
      updateArticle: (id, a) => updateArticle(cfg, locale, id, a),
      uploadAttachment: (fileName, bytes, contentType) => uploadAttachment(cfg, fileName, bytes, contentType),
    };

    const report = await executeSync({
      plan: recon,
      map,
      articles,
      deps: {
        writer,
        loadBytes: (p) => getFileBytes(p),
        persist: (m) => saveZendeskMap(m, "Zendesk sync"),
        rewriteAssets: (body, toUrl) => rewriteAssetUrls(body, toUrl),
      },
    });

    return NextResponse.json({ dryRun: false, report }, { headers: NO_STORE });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Sync failed";
    const status = /not configured/i.test(msg) ? 400 : /confirm/i.test(msg) ? 409 : 502;
    return NextResponse.json({ error: msg }, { status });
  }
}
