import { NextResponse } from "next/server";
export async function POST(){ return NextResponse.json({error:"Profile chat is unavailable because no verified Hermes profile route is configured."},{status:503}); }
