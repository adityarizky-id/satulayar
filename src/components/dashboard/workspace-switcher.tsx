import Link from "next/link";
import Image from "next/image";
import { memo, useState } from "react";

import { GoogleAdsIcon, MetaAdsIcon } from "@/components/dashboard/icons";
import type { AccountOption } from "@/lib/dashboard/accounts";

/**
 * Demo brands are fictional and ship without logo files, so every workspace
 * renders the initials fallback. Add an entry here when a real workspace
 * uploads its logo.
 */
const WORKSPACE_LOGOS: Record<string, { src: string; alt: string }> = {};

const WORKSPACE_MARKETS: Record<
  string,
  { code: string; market: string }
> = {
  "kopi-senja": { code: "ID", market: "Indonesia" },
  "batik-lestari": { code: "ID", market: "Indonesia" },
  "rumah-rajut": { code: "ID", market: "Indonesia" },
  "jamu-alami": { code: "ID", market: "Indonesia" },
  "kriya-bali": { code: "ID", market: "Indonesia" },
};

const WorkspaceLogo = memo(function WorkspaceLogo({
  account,
  marketCode,
  marketName,
}: {
  account: AccountOption;
  marketCode: string;
  marketName: string;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const logo = WORKSPACE_LOGOS[account.slug];

  if (!logo || imageFailed) {
    return (
      <span
        aria-label={`${account.name} logo unavailable; ${marketName} workspace`}
        className="workspace-logo workspace-logo--fallback"
        role="img"
      >
        <span aria-hidden="true">{marketCode}</span>
      </span>
    );
  }

  return (
    <span
      className={`workspace-logo${
        account.slug === "kopi-senja" ? " workspace-logo--wordmark" : ""
      }`}
    >
      <Image
        alt={logo.alt}
        className="workspace-logo__image"
        height={44}
        onError={() => setImageFailed(true)}
        src={logo.src}
        width={44}
      />
    </span>
  );
});

const WorkspaceRow = memo(function WorkspaceRow({
  account,
  isActive,
  onSwitch,
}: {
  account: AccountOption;
  isActive: boolean;
  onSwitch: (slug: string) => void;
}) {
  const market = WORKSPACE_MARKETS[account.slug] ?? {
    code: "EU",
    market: "Europe",
  };

  return (
    <li className={`workspace-row${isActive ? " workspace-row--active" : ""}`}>
      <WorkspaceLogo
        account={account}
        marketCode={market.code}
        marketName={market.market}
      />
      <div className="workspace-row__identity">
        <strong>{account.name}</strong>
        <span className="workspace-row__details">
          <span
            className="workspace-code-chip"
            title={market.market}
          >
            <span className="visually-hidden">{market.market} market</span>
            <span aria-hidden="true">{market.code}</span>
          </span>
          <span aria-hidden="true">·</span>
          <code>{account.currency}</code>
          <span aria-hidden="true">·</span>
          <code>{account.timezone}</code>
        </span>
      </div>
      <div
        aria-label="Advertising platforms"
        className="workspace-row__platforms"
        role="group"
      >
        {account.platforms.includes("google") && (
          <span className="platform-mark platform-mark--google" title="Google Ads">
            <GoogleAdsIcon width={18} height={18} />
            <span>Google Ads</span>
          </span>
        )}
        {account.platforms.includes("meta") && (
          <span className="platform-mark platform-mark--meta" title="Meta Ads">
            <MetaAdsIcon width={20} height={16} />
            <span>Meta Ads</span>
          </span>
        )}
      </div>
      <div className="workspace-row__actions">
        {isActive ? (
          <>
            <span className="workspace-row__active-label">Current</span>
            <Link className="console-button console-button--primary" href="/">
              Open dashboard
            </Link>
          </>
        ) : (
          <button
            className="console-button console-button--quiet"
            aria-label={`Use ${account.name} as the current workspace`}
            onClick={() => onSwitch(account.slug)}
            type="button"
          >
            Use workspace
          </button>
        )}
      </div>
    </li>
  );
});

export const WorkspaceSwitcher = memo(function WorkspaceSwitcher({
  accounts,
  activeAccount,
  onSwitch,
}: {
  accounts: AccountOption[];
  activeAccount: string;
  onSwitch: (slug: string) => void;
}) {
  const currentWorkspace = accounts.find((account) => account.slug === activeAccount);

  return (
    <section
      className="workspace-console"
      id="workspace-switcher"
      aria-labelledby="workspace-switcher-title"
    >
      <header className="workspace-console__header">
        <div>
          <h2 id="workspace-switcher-title">Workspace access</h2>
          <p>One selection controls Paid Ads, Store Analytics, and Worklog.</p>
        </div>
        <div className="workspace-console__meta">
          <span className="workspace-console__current">
            Current: <strong>{currentWorkspace?.name ?? "Not selected"}</strong>
          </span>
          <span className="integration-group__count">
            {accounts.length} {accounts.length === 1 ? "brand" : "brands"}
          </span>
        </div>
      </header>
      <ul className="workspace-list">
        {accounts.map((account) => (
          <WorkspaceRow
            account={account}
            isActive={account.slug === activeAccount}
            key={account.slug}
            onSwitch={onSwitch}
          />
        ))}
      </ul>
    </section>
  );
});
