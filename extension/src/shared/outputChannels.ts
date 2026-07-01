import * as vscode from 'vscode';

const channels = new Map<string, vscode.OutputChannel>();

export function getSharedOutputChannel(name: string): vscode.OutputChannel {
  let channel = channels.get(name);
  if (!channel) {
    channel = vscode.window.createOutputChannel(name);
    channels.set(name, channel);
  }
  return channel;
}
