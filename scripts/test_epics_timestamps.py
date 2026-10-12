#!/usr/bin/env python3
"""Test if EPICS PV timestamps are updating"""

import asyncio
from caproto.asyncio.client import Context
import time

async def test_pv_timestamps():
    ctx = Context()
    
    pv_name = "BL22:SCAN:MASTER:ADC1"
    print(f"Testing timestamps for: {pv_name}")
    print("=" * 70)
    
    pv, = await ctx.get_pvs(pv_name)
    
    subscription = pv.subscribe(data_type='time')
    
    count = 0
    timestamps = []
    
    async for event in subscription:
        count += 1
        ts = event.metadata.timestamp
        value = event.data[0] if hasattr(event.data, '__iter__') else event.data
        
        timestamps.append(ts)
        
        # Check if timestamp is changing
        if len(timestamps) > 1:
            if timestamps[-1] == timestamps[-2]:
                status = "❌ SAME"
            else:
                diff = timestamps[-1] - timestamps[-2]
                status = f"✅ CHANGED (Δ={diff:.6f}s)"
        else:
            status = "First"
        
        print(f"#{count:3d}: ts={ts:.6f}, value={value:e}, {status}")
        
        if count >= 20:
            break
    
    print("=" * 70)
    
    # Analysis
    unique_timestamps = set(timestamps)
    print(f"\nTotal messages: {len(timestamps)}")
    print(f"Unique timestamps: {len(unique_timestamps)}")
    
    if len(unique_timestamps) == 1:
        print("⚠️  WARNING: All timestamps are IDENTICAL!")
        print("   This is the problem - EPICS IOC is not updating timestamp field.")
    elif len(unique_timestamps) < len(timestamps) / 2:
        print("⚠️  WARNING: Many duplicate timestamps")
    else:
        print("✅ Timestamps are updating correctly")

if __name__ == "__main__":
    asyncio.run(test_pv_timestamps())
