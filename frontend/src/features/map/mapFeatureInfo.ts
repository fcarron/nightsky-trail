export interface MapFeatureInfo {
  kind: "closure" | "wanderland";
  title: string;
  details: Array<[string, string]>;
  schweizMobilUrl?: string;
}

export function parseClosureFeatureInfo(
  payload: string,
): MapFeatureInfo | null {
  const properties = new globalThis.Map<string, string>();
  for (const line of payload.split("\n")) {
    const match = line.match(/\.([a-z0-9_]+)_de\.name\s+=\s+'(.*)'\s*$/i);
    if (match?.[2]) {
      properties.set(match[1], match[2]);
    }
  }

  const title = properties.get("title");
  if (!title) {
    return null;
  }

  const detailKeys: Array<[string, string]> = [
    ["Status", "type"],
    ["Dauer", "duration"],
    ["Grund", "reason"],
    ["Hinweis", "abstract"],
    ["Quelle", "content_provider"],
  ];
  const details = detailKeys.flatMap(([label, key]) => {
    const value = properties.get(key);
    return value ? ([[label, value]] as Array<[string, string]>) : [];
  });

  return {
    details,
    kind: "closure",
    title,
  };
}
