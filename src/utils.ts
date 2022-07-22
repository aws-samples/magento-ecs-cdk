import { Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';

function isContextAvailable(scope: Construct, key: string) {
  return Stack.of(scope).node.tryGetContext(key);
}
/**
 * Throws if the context is not available
 */
export function throwIfNotAvailable(scope: Construct, key: string) {
  if (!isContextAvailable(scope, key)) {
    throw new Error(`${key} is required in the context variable`);
  }
}