import { z } from "zod";

export const DomainPackSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  goalTemplates: z.array(z.string().min(1)),
  taskTypes: z.array(z.string().min(1)),
  defaultPolicy: z.string().min(1),
  defaultVerifiers: z.array(z.string().min(1)),
  requiredTools: z.array(z.string().min(1)),
  supportedWorkers: z.array(z.string().min(1))
});

export type DomainPack = z.infer<typeof DomainPackSchema>;

export function parseDomainPack(input: unknown): DomainPack {
  return DomainPackSchema.parse(input);
}
