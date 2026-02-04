import mongoose from 'mongoose';
import { NextResponse } from 'next/server';
import Attempt from '@/models/Attempt';
import Test from '@/models/Test';
import connectDB from '@/lib/db';

export async function POST(req, { params }) {
  try {
    await connectDB();
    
    const { attemptId } = await params;
    
    if (!mongoose.Types.ObjectId.isValid(attemptId)) {
      return NextResponse.json({ error: 'Invalid attempt ID' }, { status: 400 });
    }
    
    const body = await req.json();
    const { type } = body;
    
    // Define violation categories
    const cameraViolations = ["CAMERA", "LOOKING_AWAY"];
    const otherViolations = ["TAB_HIDDEN", "BLUR", "FULLSCREEN_EXIT", "WINDOW_SWITCH", "MULTIPLE_TABS"];
    const allViolationTypes = [...cameraViolations, ...otherViolations];
    
    if (!type || typeof type !== 'string' || !allViolationTypes.includes(type)) {
      return NextResponse.json({ error: 'Invalid violation type' }, { status: 400 });
    }
    
    const attempt = await Attempt.findById(attemptId);
    if (!attempt) {
      return NextResponse.json({ error: 'Attempt not found' }, { status: 404 });
    }
    
    if (attempt.status !== 'active') {
      return NextResponse.json({ error: `Attempt is ${attempt.status}` }, { status: 403 });
    }
    
    const test = await Test.findById(attempt.testId).lean();
    if (!test) {
      return NextResponse.json({ error: 'Test not found' }, { status: 404 });
    }
    
    // Increment total violation count and log the violation
    attempt.violationsCount += 1;
    attempt.violations.push({ type, at: new Date() });
    
    // Check if should lock based on violation type
    let shouldLock = false;
    
    if (cameraViolations.includes(type)) {
      // Camera violations: count only camera-related violations, lock at 3
      const cameraViolationCount = attempt.violations.filter(v => 
        cameraViolations.includes(v.type)
      ).length;
      
      // Default to 3 camera violations allowed before lock (lock on 4th violation)
      const maxCameraViolations = (test.maxCameraViolations !== undefined && test.maxCameraViolations !== null) 
        ? test.maxCameraViolations 
        : 3;
      
      console.log(`Camera violation ${cameraViolationCount}/${maxCameraViolations} for attempt ${attemptId}`);
      
      if (cameraViolationCount > maxCameraViolations) {
        shouldLock = true;
        console.log(`Attempt ${attemptId} locked: ${cameraViolationCount} camera violations (max: ${maxCameraViolations})`);
      }
    } else {
      // Other violations (tab switch, blur, fullscreen, window switch, multiple tabs): lock immediately
      shouldLock = true;
      console.log(`Attempt ${attemptId} locked immediately: ${type} violation`);
    }
    
    if (shouldLock) {
      attempt.status = 'locked';
    }
    
    await attempt.save();

    // Count camera violations for response
    const finalCameraViolationCount = attempt.violations.filter(v => 
      cameraViolations.includes(v.type)
    ).length;
    
    const finalMaxCameraViolations = (test.maxCameraViolations !== undefined && test.maxCameraViolations !== null) 
      ? test.maxCameraViolations 
      : 3;

    return NextResponse.json({
      ok: true,
      violationsCount: attempt.violationsCount,
      cameraViolationsCount: finalCameraViolationCount,
      maxCameraViolations: finalMaxCameraViolations,
      status: attempt.status,
      violationType: type,
    });
  } catch (err) {
    console.error('Error recording violation:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
