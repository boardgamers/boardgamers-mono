import { intersection, isEmpty, omit, pick } from "lodash";

type Condition = Record<string, any>;

export function joinAnd(...conds: Condition[]): Condition {
  conds = conds.filter((cond) => !isEmpty(cond));

  if (!conds.length) {
    return {};
  }

  const [firstCond, secondCond] = conds;

  if (conds.length === 1) {
    return firstCond;
  }

  const extraKeys = intersection(Object.keys(firstCond), Object.keys(secondCond));

  return joinAnd(
    {
      ...firstCond,
      ...omit(secondCond, ...extraKeys),
      ...(extraKeys.length && { $and: [...(firstCond.$and ?? []), pick(secondCond, ...extraKeys)] }),
    },
    ...conds.slice(2)
  );
}
