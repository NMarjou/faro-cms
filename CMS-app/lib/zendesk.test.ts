import { describe, it, expect } from "vitest";
import { hostFromBrand } from "./zendesk";

/**
 * hostFromBrand decides which host a brand's Help Center calls route to — get it
 * wrong and the sync writes to the wrong customer help centre. Pure, so asserted.
 */
describe("hostFromBrand", () => {
  it("takes the host from the brand_url Zendesk returns", () => {
    expect(hostFromBrand({ brand_url: "https://brand-a.zendesk.com", subdomain: "brand-a" })).toBe("brand-a.zendesk.com");
  });

  it("uses a host-mapped custom domain when that's what brand_url carries", () => {
    expect(hostFromBrand({ brand_url: "https://help.acme.com", subdomain: "acme" })).toBe("help.acme.com");
  });

  it("falls back to {subdomain}.zendesk.com when brand_url is missing", () => {
    expect(hostFromBrand({ subdomain: "brand-b" })).toBe("brand-b.zendesk.com");
  });

  it("falls back to the subdomain when brand_url is unparseable", () => {
    expect(hostFromBrand({ brand_url: "not a url", subdomain: "brand-c" })).toBe("brand-c.zendesk.com");
  });
});
