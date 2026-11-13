'use client';
import {createContext} from 'react';
import type {Event} from 'nostr-tools';
export const MuteContext=createContext<(event:Pick<Event,'pubkey'|'content'|'kind'|'tags'>)=>boolean>(()=>false);
