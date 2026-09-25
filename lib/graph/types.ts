export interface StationNode {
  id: string; // station_cd
  groupId: string; // station_g_cd（同一駅の別路線ノードをまとめる）
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
  km: number; // 営業キロ
  // 運賃計算に使う距離。営業キロと違う場合だけ入る（省略時は km と同じ）。
  //
  // 名鉄は線区ごとに擬制率をかけた運賃計算キロで運賃を決め、JRは地方交通線の
  // 営業キロを約1割増した換算キロ（JR四国・九州は擬制キロ）で計算する。
  // 営業キロのまま距離帯を引くと運賃が実額より安く出る＝到達できない駅を
  // 到達できると言うことになる。倍率の定義と出典は data/fare-distance-classes.json。
  //
  // 営業キロ側を書き換えないのは、距離補正（lib/graph/calibrate.ts）と
  // 駅間キロの検証（lib/graph/station-km.ts）が実営業キロとの比較で成り立って
  // いるため。そちらを壊さずに運賃だけ正すため、別の値として持つ。
  fareKm?: number;
  kind: "rail" | "transfer";
  operator: string; // transfer のときは ""
}

export interface RailGraph {
  nodes: Record<string, StationNode>;
  edges: GraphEdge[]; // 無向。片方向だけ格納し、利用側で両方向展開する
}
