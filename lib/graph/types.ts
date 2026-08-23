export interface StationNode {
  id: string;       // station_cd
  groupId: string;  // station_g_cd（同一駅の別路線ノードをまとめる）
  name: string;
  lat: number;
  lng: number;
  lineId: string;
  lineName: string;
  operator: string; // 事業者名（company_name）
}

export interface GraphEdge {
  from: string;
  to: string;
  km: number;
  kind: "rail" | "transfer";
  operator: string; // transfer のときは ""
}

export interface RailGraph {
  nodes: Record<string, StationNode>;
  edges: GraphEdge[]; // 無向。片方向だけ格納し、利用側で両方向展開する
}
