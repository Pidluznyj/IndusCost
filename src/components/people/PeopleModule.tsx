import React from "react";
import { useParams } from "react-router-dom";
import { PeopleListPage } from "@/src/components/people/PeopleListPage";
import { PersonProfilePage } from "@/src/components/people/PersonProfilePage";

/** Pessoas 360°: `/people` lista; `/people/:personId` ficha. */
export function PeopleModule() {
  const { personId } = useParams<{ personId?: string }>();
  if (personId) return <PersonProfilePage personId={personId} />;
  return <PeopleListPage />;
}

export default PeopleModule;
