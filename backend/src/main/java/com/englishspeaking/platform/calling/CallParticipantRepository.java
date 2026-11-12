package com.englishspeaking.platform.calling;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;

public interface CallParticipantRepository extends JpaRepository<CallParticipant, CallParticipant.Key> {
    @Query("select p from CallParticipant p where p.id.callId = :callId")
    List<CallParticipant> findByCallId(@Param("callId") java.util.UUID callId);

    @Query("select p from CallParticipant p where p.id.callId in :callIds")
    List<CallParticipant> findByCallIds(@Param("callIds") Collection<java.util.UUID> callIds);
}
