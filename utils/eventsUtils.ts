export const getAllContractLogsForEvent = async (
  contract: any,
  eventName: string
): Promise<any[]> => {
  const allLogs = await contract.queryFilter("*");
  const allEventLogs = allLogs.filter(
    (log: Record<string, any>) => log.event === eventName
  );
  return allEventLogs;
};
