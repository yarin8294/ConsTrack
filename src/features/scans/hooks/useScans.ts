import { useAppData } from "../../../app/data/useAppData";

export function useScans() {
  const ctx = useAppData();
  return {
    scans: ctx.data.scans,
    isLoading: ctx.isLoading,
    selectedT1: ctx.data.selectedT1,
    selectedT2: ctx.data.selectedT2,
    addScan: ctx.addScan,
    removeScan: ctx.removeScan,
    setSelectedT1: ctx.setSelectedT1,
    setSelectedT2: ctx.setSelectedT2,
  };
}
