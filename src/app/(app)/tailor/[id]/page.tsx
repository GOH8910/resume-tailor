"use client";

import { useParams } from "next/navigation";
import { ReviewScreen } from "@/ui/review/ReviewScreen";

export default function ReviewPage() {
  const { id } = useParams<{ id: string }>();
  return <ReviewScreen applicationId={id} />;
}
